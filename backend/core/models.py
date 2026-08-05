"""
backend/core/models.py

Core relational schema for Glix.
Optimized for PostgreSQL: explicit indexes, unique constraints, and
ArrayField usage for lightweight tag/badge storage without extra join tables.
"""

import uuid
from decimal import Decimal

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class UserProfile(models.Model):
    """
    Extends the standard Django User with Glix-specific
    tracking metadata. Kept as a separate 1:1 table (rather than a
    custom User model) to avoid disrupting Django's built-in auth
    machinery and admin integration.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="profile",
    )
    profile_picture = models.URLField(
        max_length=500,
        null=True,
        blank=True,
        help_text="Public URL to the user's avatar image.",
    )
    total_time_watched = models.PositiveIntegerField(
        default=0,
        help_text="Cumulative minutes watched, derived from summed episode runtimes.",
    )
    # Phase 75.7: a rewatch (ShowRewatch/RewatchEpisodeState/MovieRewatch)
    # increments BOTH this field and total_time_watched above — totals grow
    # to reflect genuine re-viewing time, while this field keeps the
    # rewatch-only breakdown recoverable for the Analytics "Rewatched" tile
    # without a second full aggregation query over the rewatch tables.
    total_rewatch_time_watched = models.PositiveIntegerField(
        default=0,
        help_text="Cumulative minutes watched via a rewatch — a subset already included in total_time_watched.",
    )
    earned_badges = ArrayField(
        base_field=models.CharField(max_length=64),
        default=list,
        blank=True,
        help_text="Slugs of unlocked milestone badges, e.g. 'binge_master', 'anime_fan'.",
    )
    # Phase 74 — "ghost mode" for the social layer (core/social_views.py).
    # When True: excluded from user search, UserProfileDetailView returns a
    # stub, and the user's activity never appears in anyone's friends feed.
    # Deliberately all-or-nothing — a per-field visibility matrix or a
    # follow-request/approve flow is the over-engineered version of this
    # and is not built (see Follow model's own docstring for why a request
    # flow would also break its presence-based convention).
    is_private = models.BooleanField(
        default=False,
        help_text="Ghost mode: excluded from user search, activity feed, and public profile.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "user_profile"
        indexes = [
            models.Index(fields=["total_time_watched"], name="idx_profile_time_watched"),
        ]

    def __str__(self) -> str:
        return f"Profile<{self.user.username}>"


class SocialAccount(models.Model):
    """
    Links a Django User to a third-party identity (Google/Apple "sub"
    claim, verified server-side in core/social_auth.py). A plain FK, not
    OneToOne — a user may accumulate more than one (Google now, Apple
    later). Uniqueness is on (provider, provider_user_id), the stable
    identity key — never on email, which can be absent, unverified, or
    an Apple private-relay address that changes per app.
    """

    class Provider(models.TextChoices):
        GOOGLE = "google", "Google"
        APPLE = "apple", "Apple"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="social_accounts",
    )
    provider = models.CharField(max_length=16, choices=Provider.choices)
    provider_user_id = models.CharField(
        max_length=255,
        help_text="Stable 'sub' claim from the provider's ID token.",
    )
    email = models.EmailField(
        blank=True,
        help_text="Email asserted by the provider at link time (may be an Apple private-relay address).",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "social_account"
        constraints = [
            models.UniqueConstraint(
                fields=["provider", "provider_user_id"], name="uniq_social_provider_identity"
            ),
        ]
        indexes = [
            models.Index(fields=["user", "provider"], name="idx_social_user_provider"),
        ]

    def __str__(self) -> str:
        return f"SocialAccount<{self.provider}:{self.user.username}>"


class CachedShow(models.Model):
    """
    Local cache of TMDB /tv/{id} payloads. tmdb_id is used directly as
    the primary key so foreign keys elsewhere resolve without an
    intermediate lookup table, and re-fetches from TMDB become simple
    upserts keyed on the same id TMDB already assigns.
    """

    class Status(models.TextChoices):
        RETURNING = "RETURNING", "Returning Series"
        ENDED = "ENDED", "Ended"
        CANCELED = "CANCELED", "Canceled"
        IN_PRODUCTION = "IN_PRODUCTION", "In Production"

    tmdb_id = models.PositiveIntegerField(primary_key=True)
    title = models.CharField(max_length=255, db_index=True)
    overview = models.TextField(blank=True)
    poster_path = models.CharField(max_length=255, null=True, blank=True)
    backdrop_path = models.CharField(max_length=255, null=True, blank=True)
    first_air_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.RETURNING,
    )
    vote_average = models.FloatField(default=0.0)
    total_seasons = models.PositiveIntegerField(default=0)
    total_episodes = models.PositiveIntegerField(default=0)
    # ISO 639-1 code from TMDB's `original_language` (e.g. "en", "ko", "ja").
    # Blank for rows cached before this field existed, until next TMDB refresh.
    original_language = models.CharField(max_length=8, blank=True)
    genres = ArrayField(
        base_field=models.CharField(max_length=64),
        default=list,
        blank=True,
    )
    # TMDB's `networks` array (e.g. [{"name": "Netflix"}]) from the /tv/{id}
    # payload — always present in the base response, no append_to_response
    # needed. Existed in the payload from day one but was discarded until
    # this field: it's what lets core/airtime_platforms.py's platform-
    # estimate tier guess a well-known streaming platform's conventional
    # drop time (e.g. "Netflix originals drop at midnight Pacific") for a
    # show TVmaze has no schedule for at all. Never used to pick a display
    # name — `title` already covers that — purely a lookup key into
    # PLATFORM_AIR_TIME_CONVENTIONS.
    networks = ArrayField(
        base_field=models.CharField(max_length=128),
        default=list,
        blank=True,
    )
    # TMDB's /tv/{id} payload includes a `next_episode_to_air` object whenever
    # TMDB knows a premiere date, even before that season's individual
    # episodes are otherwise cached (e.g. a freshly-announced new season with
    # only a premiere date confirmed, no per-episode data yet). Storing it
    # directly on the show lets the Upcoming tab surface a real countdown for
    # a watchlisted show's next season/episode without waiting on
    # get_season_episodes() to have cached that season at all — see
    # lib/upcoming.ts's buildUpcomingItems().
    # TMDB has no air-*time* data at all: every episode payload carries a
    # bare `air_date` ("2026-08-03") and nothing else, which is why the
    # widget's old countdown always counted down to local midnight and so
    # always ended in "00m". The network's actual broadcast time comes from
    # TVmaze instead (see core/airtime.py) — `airs_time` is the wall-clock
    # time in `airs_timezone` (an IANA name like "America/New_York"), the
    # pair the client needs to render a correct local "9:30 PM" for any
    # given episode date, DST included. Both blank/null for shows TVmaze
    # doesn't know, or that have no fixed slot (most streaming originals).
    airs_time = models.TimeField(null=True, blank=True)
    airs_timezone = models.CharField(max_length=64, blank=True)
    # Which tier resolved airs_time/airs_timezone above, so the client can
    # tell a confirmed broadcast time from a guess rather than rendering
    # both identically — core/airtime.py's founding principle is "better to
    # show no time than a wrong one", and an unmarked platform guess would
    # violate that just as much as a wrong one would. One of:
    #   "tvmaze_exact"      — TVmaze published a real per-episode airstamp
    #                          for this show (CachedEpisode.air_datetime /
    #                          next_episode_air_datetime), the most precise
    #                          source there is.
    #   "tvmaze_slot"       — TVmaze knows the show's fixed weekly network
    #                          slot (schedule.time), but no per-episode
    #                          instant.
    #   "platform_estimate" — neither of the above; airs_time/airs_timezone
    #                          were filled from airtime_platforms.py's
    #                          conventional-drop-time table instead. The
    #                          client prefixes its rendered time with "~"
    #                          for this source (lib/dateFormat.ts's
    #                          formatLocalAirTime).
    #   ""                  — no time known from any source.
    air_time_source = models.CharField(max_length=24, blank=True)
    # When TVmaze was last asked about this show — including when it
    # answered "no schedule". Without it, every 6-hourly refresh_show_cache
    # sweep would re-ask TVmaze about every show forever, and shows with no
    # air time would be retried hardest. See AIRTIME_RECHECK_AFTER.
    airtime_checked_at = models.DateTimeField(null=True, blank=True)
    # TVmaze's own id for this show, cached from the /lookup/shows call
    # fetch_air_time() already makes, so fetch_episode_airstamps() can hit
    # /shows/{id}/episodes directly instead of repeating the lookup.
    tvmaze_id = models.PositiveIntegerField(null=True, blank=True)
    next_episode_air_date = models.DateField(null=True, blank=True)
    next_episode_season_number = models.PositiveIntegerField(null=True, blank=True)
    next_episode_number = models.PositiveIntegerField(null=True, blank=True)
    next_episode_name = models.CharField(max_length=255, null=True, blank=True)
    # Exact UTC instant for next_episode_*, from TVmaze's per-episode
    # `airstamp` (see core/airtime.py). The synthetic "next episode to air"
    # item has no CachedEpisode row of its own, so it needs its own instant
    # field rather than reusing CachedEpisode.air_datetime. Null whenever
    # TVmaze doesn't know this episode yet.
    next_episode_air_datetime = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cached_show"
        indexes = [
            models.Index(fields=["status"], name="idx_show_status"),
            models.Index(fields=["last_synced_at"], name="idx_show_last_synced"),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.tmdb_id})"


class CachedEpisode(models.Model):
    """
    Local cache of TMDB /tv/{id}/season/{s}/episode/{e} payloads.
    tmdb_id here is TMDB's globally-unique episode id (not the
    per-season episode_number), so it is safe as a standalone PK.
    """

    tmdb_id = models.PositiveIntegerField(primary_key=True)
    show = models.ForeignKey(
        CachedShow,
        on_delete=models.CASCADE,
        related_name="episodes",
    )
    season_number = models.PositiveIntegerField()
    episode_number = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    overview = models.TextField(blank=True)
    air_date = models.DateField(null=True, blank=True, db_index=True)
    # Exact UTC instant this episode airs, from TVmaze's per-episode
    # `airstamp` (core/airtime.py's fetch_episode_airstamps) — present even
    # for streaming originals with no fixed weekly slot, unlike
    # CachedShow.airs_time/airs_timezone which only covers a network's
    # broadcast slot. Null until a sync has matched this episode by
    # (season_number, episode_number) against TVmaze; the client falls back
    # to the slot pair, then to local midnight (lib/dateFormat.ts's
    # resolveAirInstant).
    air_datetime = models.DateTimeField(null=True, blank=True, db_index=True)
    # True when `air_datetime` above was filled by the platform-estimate
    # tier (core/airtime_platforms.py) rather than a real TVmaze airstamp.
    # Reserved for a future per-episode estimate — as of this field's
    # introduction nothing actually sets it True, since the platform-
    # estimate tier only ever resolves a show-level slot
    # (CachedShow.airs_time/airs_timezone via air_time_source=
    # "platform_estimate"), never writes a per-episode air_datetime here.
    # The client instead derives "is this episode's time an estimate?"
    # straight from CachedShow.air_time_source plus "this episode has no
    # air_datetime of its own" (see lib/upcoming.ts) — cheaper than
    # backfilling this column for a case that can't occur yet, and it
    # still means something correct once/if a per-episode estimate source
    # is ever added.
    air_datetime_estimated = models.BooleanField(default=False)
    runtime_minutes = models.PositiveIntegerField(
        default=0,
        help_text="Used to increment/decrement UserProfile.total_time_watched on toggle.",
    )
    still_path = models.CharField(max_length=255, null=True, blank=True)
    # Set the moment a "new episode" push actually goes out for this
    # episode, so the periodic refresh sweep can notify on "aired today and
    # not yet announced" instead of "aired today and was never cached
    # before". The old condition could essentially never be true: TMDB
    # publishes episode rows weeks ahead of air date and sync_active_shows
    # caches them every 6 hours, so by the time air_date == today the
    # episode was always already known and was excluded from the alert.
    notified_at = models.DateTimeField(null=True, blank=True)
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "cached_episode"
        constraints = [
            models.UniqueConstraint(
                fields=["show", "season_number", "episode_number"],
                name="unique_show_season_episode",
            ),
        ]
        indexes = [
            models.Index(fields=["show", "season_number"], name="idx_episode_show_season"),
            models.Index(fields=["air_date"], name="idx_episode_air_date"),
        ]
        ordering = ["season_number", "episode_number"]

    def __str__(self) -> str:
        return f"{self.show.title} S{self.season_number:02d}E{self.episode_number:02d}"


class Watchlist(models.Model):
    """
    Join table between a user and a show they are tracking. Drives the
    three-way categorization on GET /api/watchlist/. `status` is a
    manually-settable override (e.g. user archives a show early);
    the view layer recomputes To-Watch vs Up-To-Date dynamically from
    WatchState rows and only respects this field for ARCHIVED.
    """

    class Status(models.TextChoices):
        TO_WATCH = "TO_WATCH", "To Watch"
        UP_TO_DATE = "UP_TO_DATE", "Up To Date"
        ARCHIVED = "ARCHIVED", "Archived"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="watchlist_entries",
    )
    show = models.ForeignKey(
        CachedShow,
        on_delete=models.CASCADE,
        related_name="watchlist_entries",
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.TO_WATCH,
    )
    is_favorite = models.BooleanField(default=False)
    ignore_catchup = models.BooleanField(
        default=False,
        help_text=(
            "If true, skip the 'mark previous episodes watched?' Catch-Up "
            "modal for this show — always behave as if the user chose "
            "'just this one'. Set via 'Never for this show' in the modal."
        ),
    )
    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "watchlist"
        constraints = [
            models.UniqueConstraint(fields=["user", "show"], name="unique_user_show_watchlist"),
        ]
        indexes = [
            models.Index(fields=["user", "status"], name="idx_watchlist_user_status"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} -> {self.show.title} [{self.status}]"


class WatchState(models.Model):
    """
    Core tracking table. A row's existence means the episode is
    watched; toggling deletes/recreates it rather than flipping a
    boolean, keeping the hot-path index (user, episode_id) small and
    the UNIQUE constraint doing double duty as the "already watched"
    check used by services.py and views.py.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="watch_states",
    )
    episode = models.ForeignKey(
        CachedEpisode,
        on_delete=models.CASCADE,
        related_name="watch_states",
        db_column="episode_id",
    )
    # default=timezone.now, not auto_now_add: auto_now_add overwrites the
    # value on every insert, which made it impossible to backfill a real
    # historical date during a TV Time import. Every normal call site
    # omits this field and still gets "now"; WatchStateSerializer pins it
    # read_only, so it stays unsettable over the API.
    watched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "watch_state"
        constraints = [
            models.UniqueConstraint(fields=["user", "episode"], name="unique_user_episode_id"),
        ]
        indexes = [
            models.Index(fields=["user", "episode"], name="idx_watchstate_user_episode"),
            models.Index(fields=["user", "watched_at"], name="idx_watchstate_user_watched_at"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} watched {self.episode_id}"


class EpisodeInteraction(models.Model):
    """
    Stores the per-episode emotion reaction and MVP character vote.
    One row per (user, episode); resubmitting updates it in place via
    update_or_create rather than accumulating duplicate votes.
    """

    class Emotion(models.TextChoices):
        HAPPY = "HAPPY", "😄 Happy"
        SHOCKED = "SHOCKED", "😱 Shocked"
        SAD = "SAD", "😢 Sad"
        GOOD = "GOOD", "👍 Good"
        FUN = "FUN", "🎉 Fun"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="episode_interactions",
    )
    episode = models.ForeignKey(
        CachedEpisode,
        on_delete=models.CASCADE,
        related_name="interactions",
        db_column="episode_id",
    )
    emotion_emoji = models.CharField(
        max_length=10,
        choices=Emotion.choices,
        blank=True,
    )
    mvp_character_id = models.IntegerField(
        null=True,
        blank=True,
        help_text="TMDB credit/person id of the voted MVP character.",
    )
    mvp_character_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "episode_interaction"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "episode"], name="unique_user_episode_interaction"
            ),
        ]
        indexes = [
            models.Index(fields=["user", "episode"], name="idx_interaction_user_episode"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} reaction on {self.episode_id}"


class Comment(models.Model):
    """
    A comment on either a show or an episode (exactly one of the two
    FKs is set — enforced by the CheckConstraint below), or a reply to
    another Comment when `parent` is set. Replies-to-replies are
    supported by the same self-FK, giving unlimited nesting depth in
    the data model; the API only ever fetches one level of children at
    a time (GET /comments/<id>/replies/) rather than inlining a whole
    tree, so deep threads don't blow up a single response.

    Deletion is soft (`is_deleted`) rather than a real DELETE, so a
    removed comment's replies aren't orphaned — the row survives with
    its body replaced client-side by a placeholder (see
    CommentSerializer.get_body).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comments",
    )
    show = models.ForeignKey(
        CachedShow,
        on_delete=models.CASCADE,
        related_name="comments",
        null=True,
        blank=True,
    )
    episode = models.ForeignKey(
        CachedEpisode,
        on_delete=models.CASCADE,
        related_name="comments",
        null=True,
        blank=True,
    )
    parent = models.ForeignKey(
        "self",
        on_delete=models.CASCADE,
        related_name="replies",
        null=True,
        blank=True,
    )
    body = models.TextField(max_length=2000)
    is_spoiler = models.BooleanField(
        default=False,
        help_text="Author-flagged spoiler; hidden behind a reveal tap client-side regardless of watch state.",
    )
    is_edited = models.BooleanField(default=False)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "comment"
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(show__isnull=False, episode__isnull=True)
                    | models.Q(show__isnull=True, episode__isnull=False)
                ),
                name="comment_exactly_one_target",
            ),
        ]
        indexes = [
            models.Index(fields=["show", "parent", "-created_at"], name="idx_comment_show_feed"),
            models.Index(
                fields=["episode", "parent", "-created_at"], name="idx_comment_episode_feed"
            ),
            models.Index(fields=["parent", "created_at"], name="idx_comment_replies"),
            models.Index(fields=["user"], name="idx_comment_user"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        target = f"show={self.show_id}" if self.show_id else f"episode={self.episode_id}"
        return f"Comment<{self.user.username}, {target}>"


class CommentLike(models.Model):
    """
    Presence-based like, mirroring WatchState's pattern: a row's
    existence means the user liked the comment. Uniqueness on
    (user, comment) is both the "already liked" check and the index
    used to compute like_count via annotation in comment_views.py.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comment_likes",
    )
    comment = models.ForeignKey(
        Comment,
        on_delete=models.CASCADE,
        related_name="likes",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "comment_like"
        constraints = [
            models.UniqueConstraint(fields=["user", "comment"], name="unique_user_comment_like"),
        ]
        indexes = [
            models.Index(fields=["comment"], name="idx_commentlike_comment"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} likes {self.comment_id}"


class CommentReport(models.Model):
    """
    A user flagging a comment for moderator review. One report per
    (user, comment) — resubmitting is blocked client-side by checking
    for an existing report rather than the API silently upserting, so
    a changed mind requires explicit re-reporting after a dismissal
    rather than quietly resurfacing.
    """

    class Reason(models.TextChoices):
        SPAM = "SPAM", "Spam"
        HARASSMENT = "HARASSMENT", "Harassment or abuse"
        SPOILER = "SPOILER", "Unmarked spoiler"
        OFF_TOPIC = "OFF_TOPIC", "Off-topic"
        OTHER = "OTHER", "Other"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending review"
        REMOVED = "REMOVED", "Comment removed"
        DISMISSED = "DISMISSED", "Dismissed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    reporter = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="comment_reports_filed",
    )
    comment = models.ForeignKey(
        Comment,
        on_delete=models.CASCADE,
        related_name="reports",
    )
    reason = models.CharField(max_length=20, choices=Reason.choices)
    details = models.TextField(max_length=500, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name="comment_reports_reviewed",
        null=True,
        blank=True,
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "comment_report"
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "comment"], name="unique_reporter_comment_report"
            ),
        ]
        indexes = [
            models.Index(fields=["status", "-created_at"], name="idx_report_status_created"),
            models.Index(fields=["comment"], name="idx_report_comment"),
        ]
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Report<{self.comment_id}, {self.reason}, {self.status}>"


class Follow(models.Model):
    """
    Presence-based follow edge (Phase 74) — mirrors CommentLike/WatchState:
    the row's existence IS the relationship, not a boolean field. No
    `status` field on purpose: a follow-request/approve flow would turn
    this into a state machine and break that presence-based convention.
    UserProfile.is_private ("ghost mode") covers the real privacy need at
    a fraction of the complexity — see its own help_text.

    Not to be confused with SocialAccount (Google/Apple OAuth identity
    linking, core/social_auth.py) — this is the follow graph, a
    completely different concept that happens to share the word "social".
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    follower = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="outgoing_follows",
    )
    following = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="incoming_follows",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "follow"
        constraints = [
            models.UniqueConstraint(fields=["follower", "following"], name="unique_follower_following"),
            models.CheckConstraint(
                condition=~models.Q(follower=models.F("following")),
                name="follow_not_self",
            ),
        ]
        indexes = [
            models.Index(fields=["follower", "-created_at"], name="idx_follow_follower_created"),
            models.Index(fields=["following", "-created_at"], name="idx_follow_following_created"),
        ]

    def __str__(self) -> str:
        return f"Follow<{self.follower_id} -> {self.following_id}>"


class WatchStreak(models.Model):
    """
    Tracks the user's consecutive-day watch streak. A row's existence
    means the user has watched at least one episode; the streak counter
    is incremented when the watch date advances by exactly one calendar
    day, and reset to 1 on any larger gap.

    Kept as a separate table (rather than fields on UserProfile) so that
    streak resets are an isolated write and do not touch the profile row
    on every missed day — the reset happens lazily on the next watch event.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="watch_streak",
    )
    current_streak = models.PositiveIntegerField(
        default=0,
        help_text="Number of consecutive calendar days with at least one watched episode.",
    )
    longest_streak = models.PositiveIntegerField(
        default=0,
        help_text="All-time record for consecutive days watched.",
    )
    total_streak_days = models.PositiveIntegerField(
        default=0,
        help_text="Total number of distinct calendar days on which at least one episode was watched.",
    )
    last_watch_date = models.DateField(
        null=True,
        blank=True,
        help_text="Calendar date (UTC) of the most recent episode watch.",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "watch_streak"

    def __str__(self) -> str:
        return f"Streak<{self.user.username}, current={self.current_streak}>"


class NotificationPreference(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notification_preference')
    push_token = models.CharField(max_length=255, null=True, blank=True)
    notify_new_episode = models.BooleanField(default=True)
    notify_weekly_digest = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "notification_preference"

    def __str__(self) -> str:
        return f"Notifications for {self.user.username}"


class MovieCache(models.Model):
    """
    Local cache of TMDB /movie/{id} payloads. tmdb_id is used as the
    primary key (TMDB's globally unique movie ID) so foreign keys from
    MovieWatchState resolve without an extra lookup, and re-fetches from
    TMDB are simple upserts keyed on the same id TMDB already assigns.

    Genres are stored as a comma-separated string (not ArrayField) to
    keep the schema lean — movies have far fewer genre combinations than
    shows and we never query by genre in the current scope.
    """

    tmdb_id = models.PositiveIntegerField(primary_key=True)
    title = models.CharField(max_length=255, db_index=True)
    overview = models.TextField(blank=True)
    poster_path = models.CharField(max_length=255, null=True, blank=True)
    backdrop_path = models.CharField(max_length=255, null=True, blank=True)
    release_date = models.DateField(null=True, blank=True)
    runtime_minutes = models.PositiveIntegerField(
        default=0,
        help_text="Used to increment/decrement UserProfile.total_time_watched on toggle.",
    )
    genres_string = models.CharField(
        max_length=255,
        blank=True,
        help_text="Comma-separated genre names, e.g. 'Drama, Comedy, Thriller'.",
    )
    vote_average = models.FloatField(default=0.0)
    # ISO 639-1 code from TMDB's `original_language` (e.g. "en", "ko", "ja").
    # Blank for rows cached before this field existed, until next TMDB refresh.
    original_language = models.CharField(max_length=8, blank=True)
    last_synced_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "movie_cache"
        indexes = [
            models.Index(fields=["last_synced_at"], name="idx_movie_last_synced"),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.tmdb_id})"


class MovieWatchState(models.Model):
    """
    Presence-based watch state for movies. A row's existence means the
    user has watched the movie; toggling deletes/recreates it rather
    than flipping a boolean — same architectural pattern as WatchState
    for TV episodes. This keeps the hot-path index small and the UNIQUE
    constraint doing double duty as the 'already watched' check.

    Watching a movie increments UserProfile.total_time_watched by
    MovieCache.runtime_minutes via F() expression in the view layer
    (mirrors WatchStateToggleView's atomic update pattern exactly).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="movie_watch_states",
    )
    movie = models.ForeignKey(
        MovieCache,
        on_delete=models.CASCADE,
        related_name="watch_states",
        db_column="movie_id",
    )
    # default=timezone.now for the same reason as WatchState.watched_at —
    # a TV Time import needs to write the real historical date.
    watched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "movie_watch_state"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "movie"], name="unique_user_movie_watch"
            ),
        ]
        indexes = [
            models.Index(fields=["user", "movie"], name="idx_moviewatch_user_movie"),
            models.Index(fields=["user", "watched_at"], name="idx_moviewatch_user_watched_at"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} watched {self.movie.title}"


class ShowRewatch(models.Model):
    """
    A rewatch "round" for one (user, show) — Phase 75.7. round_number
    starts at 2 (the first watch-through is WatchState itself, never a
    round here), so "Round N" in the UI always means the Nth time through.

    Kept as its own table rather than relaxing WatchState's
    UNIQUE(user, episode) — that constraint is load-bearing across several
    other call sites (badges, analytics counts, history, the catch-up
    check) that all mean "has this ever been watched"; a rewatch is
    deliberately invisible to every one of them, which a parallel table
    guarantees and a relaxed constraint would not.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="show_rewatches",
    )
    show = models.ForeignKey(
        CachedShow,
        on_delete=models.CASCADE,
        related_name="rewatches",
    )
    round_number = models.PositiveIntegerField()
    started_at = models.DateTimeField(default=timezone.now)
    # Null while the round is in progress; stamped once every aired episode
    # has a RewatchEpisodeState row (RewatchEpisodeToggleView).
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "show_rewatch"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "show", "round_number"], name="unique_user_show_round"
            ),
        ]
        indexes = [
            models.Index(fields=["user", "show", "completed_at"], name="idx_rewatch_user_show_done"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} rewatching {self.show.title} (round {self.round_number})"


class RewatchEpisodeState(models.Model):
    """
    Presence-based per-episode tick within one ShowRewatch round (Phase
    75.7) — the same "row exists = watched" convention WatchState uses,
    scoped to the round instead of directly to the user so concurrent/past
    rounds never collide with each other.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    rewatch = models.ForeignKey(
        ShowRewatch,
        on_delete=models.CASCADE,
        related_name="episode_states",
    )
    episode = models.ForeignKey(
        CachedEpisode,
        on_delete=models.CASCADE,
        related_name="rewatch_states",
    )
    watched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "rewatch_episode_state"
        constraints = [
            models.UniqueConstraint(fields=["rewatch", "episode"], name="unique_rewatch_episode"),
        ]
        indexes = [
            models.Index(fields=["rewatch", "episode"], name="idx_rewatch_state_rewatch_ep"),
        ]

    def __str__(self) -> str:
        return f"Rewatch<{self.rewatch_id}> watched {self.episode_id}"


class MovieRewatch(models.Model):
    """
    Append-only rewatch counter for a movie (Phase 75.7) — not a toggle:
    "watched again" is a real repeatable event with no natural single
    "current" state to flip, unlike MovieWatchState (presence-based
    because a movie is simply watched or not). Deleting the most recent
    row is how the UI undoes an accidental "Watch again" tap — see
    MovieRewatchCreateView.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="movie_rewatches",
    )
    movie = models.ForeignKey(
        MovieCache,
        on_delete=models.CASCADE,
        related_name="rewatches",
    )
    watched_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "movie_rewatch"
        indexes = [
            models.Index(fields=["user", "movie"], name="idx_movierewatch_user_movie"),
            models.Index(fields=["user", "watched_at"], name="idx_movierewatch_user_time"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} rewatched {self.movie.title}"


class MovieWatchlist(models.Model):
    """
    Join table between a user and a movie they want to track.
    Mirrors the Watchlist model for TV shows — auto-created when the
    user adds a movie via the TMDB search flow or checks it in the
    Movies tab for the first time.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="movie_watchlist_entries",
    )
    movie = models.ForeignKey(
        MovieCache,
        on_delete=models.CASCADE,
        related_name="watchlist_entries",
    )
    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "movie_watchlist"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "movie"], name="unique_user_movie_watchlist"
            ),
        ]
        indexes = [
            models.Index(fields=["user"], name="idx_movie_watchlist_user"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} → {self.movie.title}"


class CustomList(models.Model):
    """
    A user-created list (e.g. "Movies2026") for personal organization —
    distinct from Watchlist/MovieWatchlist, the built-in "want to watch"
    trackers every tracked show/movie already gets automatically. A show
    or movie can belong to any number of these independently of its
    Watchlist/MovieWatchlist state.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="custom_lists",
    )
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=280, blank=True)
    is_private = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "custom_list"
        indexes = [
            models.Index(fields=["user", "-updated_at"], name="idx_customlist_user_updated"),
        ]
        ordering = ["-updated_at"]

    def __str__(self) -> str:
        return f"{self.user.username}: {self.name}"


class CustomListItem(models.Model):
    """
    One show/movie in a CustomList. Stores media_type + tmdb_id directly
    rather than a Django FK to CachedShow/MovieCache: an item must
    polymorphically reference either table, and this codebase has no
    GenericForeignKey/contenttypes precedent to build on. Safe without a
    DB-level FK because CachedShow/MovieCache rows are only ever
    update_or_create'd, never deleted (see TMDBService), and the only way
    to add an item is from a show/movie detail screen the user already has
    open — which itself just forced that exact row to exist via
    get_show_details()/get_movie_details().
    """

    class MediaType(models.TextChoices):
        TV = "tv", "TV Show"
        MOVIE = "movie", "Movie"

    list = models.ForeignKey(CustomList, on_delete=models.CASCADE, related_name="items")
    media_type = models.CharField(max_length=5, choices=MediaType.choices)
    tmdb_id = models.PositiveIntegerField()
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "custom_list_item"
        constraints = [
            models.UniqueConstraint(
                fields=["list", "media_type", "tmdb_id"], name="unique_list_media_tmdb"
            ),
        ]
        indexes = [
            models.Index(fields=["list"], name="idx_customlistitem_list"),
            models.Index(fields=["media_type", "tmdb_id"], name="idx_customlistitem_media_tmdb"),
        ]
        ordering = ["-added_at"]

    def __str__(self) -> str:
        return f"{self.list.name}: {self.media_type}#{self.tmdb_id}"


class ShowReview(models.Model):
    """
    A user's personal 1-5 star rating + optional note for a show
    (Phase L). Private-by-default — deliberately NOT wired into the
    Comment/CommentLike/CommentReport community system: Comment is a
    public, moderatable discussion thread, while a rating is closer to
    a personal log entry (same reasoning Letterboxd/Trakt/TV Time use).
    A user can freely rate something 2 stars without that becoming a
    public post. One review per (user, show) — POSTing again updates
    it in place rather than creating a second row, mirroring
    MovieWatchlist/Watchlist's own get_or_create upsert convention.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="show_reviews",
    )
    show = models.ForeignKey(
        CachedShow,
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    # Half-star (Letterboxd-style), Phase 74 — was PositiveSmallIntegerField
    # 1-5. Decimal, not a half-unit integer (1-10): Decimal says what it
    # means and Avg() aggregates cleanly if a public/average rating is ever
    # added; a half-unit int column is a landmine (every future reader has
    # to remember to /2). Migration is a pure ALTER — Postgres casts
    # smallint->numeric implicitly, no data migration needed. The check
    # constraint below is the real half-step gate; the validators are a
    # cheap first line of defense at the model/admin-form layer.
    rating = models.DecimalField(
        max_digits=2,
        decimal_places=1,
        validators=[MinValueValidator(Decimal("0.5")), MaxValueValidator(Decimal("5.0"))],
    )
    note = models.TextField(blank=True, max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "show_review"
        constraints = [
            models.UniqueConstraint(fields=["user", "show"], name="unique_user_show_review"),
            models.CheckConstraint(
                condition=models.Q(rating__in=[Decimal(str(n / 2)) for n in range(1, 11)]),
                name="show_review_rating_half_steps",
            ),
        ]
        indexes = [
            models.Index(fields=["show"], name="idx_show_review_show"),
            models.Index(fields=["user", "-updated_at"], name="idx_show_review_user"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} rated {self.show.title}: {self.rating}/5"


class MovieReview(models.Model):
    """Movie counterpart to ShowReview — same private-by-default reasoning."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="movie_reviews",
    )
    movie = models.ForeignKey(
        MovieCache,
        on_delete=models.CASCADE,
        related_name="reviews",
    )
    # Half-star — see ShowReview.rating's comment for the full reasoning.
    rating = models.DecimalField(
        max_digits=2,
        decimal_places=1,
        validators=[MinValueValidator(Decimal("0.5")), MaxValueValidator(Decimal("5.0"))],
    )
    note = models.TextField(blank=True, max_length=2000)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "movie_review"
        constraints = [
            models.UniqueConstraint(fields=["user", "movie"], name="unique_user_movie_review"),
            models.CheckConstraint(
                condition=models.Q(rating__in=[Decimal(str(n / 2)) for n in range(1, 11)]),
                name="movie_review_rating_half_steps",
            ),
        ]
        indexes = [
            models.Index(fields=["movie"], name="idx_movie_review_movie"),
            models.Index(fields=["user", "-updated_at"], name="idx_movie_review_user"),
        ]

    def __str__(self) -> str:
        return f"{self.user.username} rated {self.movie.title}: {self.rating}/5"


class ImportJob(models.Model):
    """
    Tracks one TV Time import run. The import resolves every entry
    against TMDB (~1100 sequential calls for a full 200-series export),
    so it cannot run inside a request — TVTimeImportView writes a row
    here, hands the id to run_tvtime_import, and returns immediately.
    The client polls ImportJobStatusView for progress.

    processed/total drive the client's ProgressRing; the four counters
    are the final "Imported / Skipped / Not Found" report. errors is
    capped by ERROR_CAP in the task — an export with hundreds of
    unresolvable titles should not write an unbounded blob per row.
    """

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        RUNNING = "RUNNING", "Running"
        SUCCESS = "SUCCESS", "Success"
        FAILED = "FAILED", "Failed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="import_jobs",
    )
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    payload = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Normalised export, staged here rather than passed as a Celery "
            "argument — a full series export is ~3MB and the broker is the "
            "wrong place to put it. Cleared once the run SUCCEEDS; kept on "
            "FAILED (alongside `processed`) so TVTimeImportView can resume "
            "a byte-identical resubmission instead of restarting from zero."
        ),
    )
    payload_fingerprint = models.CharField(
        max_length=64,
        blank=True,
        db_index=True,
        help_text=(
            "sha256 of the sorted payload, computed once at job creation. "
            "TVTimeImportView compares a resubmission's fingerprint against "
            "this instead of re-fetching and deep-comparing a multi-MB "
            "`payload` JSONField on every retry — the same resume check for "
            "a fraction of the CPU/DB cost, which matters on a free-tier "
            "single-worker box under exactly the retry traffic (a user "
            "hitting 'try again' after a failed import) this exists to help."
        ),
    )

    total = models.PositiveIntegerField(
        default=0, help_text="Shows + movies to process. Denominator for progress."
    )
    processed = models.PositiveIntegerField(
        default=0, help_text="Shows + movies resolved so far (succeeded or not)."
    )

    shows_imported = models.PositiveIntegerField(default=0)
    shows_skipped = models.PositiveIntegerField(default=0)
    movies_imported = models.PositiveIntegerField(default=0)
    movies_skipped = models.PositiveIntegerField(default=0)
    episodes_marked = models.PositiveIntegerField(
        default=0, help_text="WatchState rows created. The number users actually care about."
    )

    errors = ArrayField(models.TextField(), default=list, blank=True)
    detail = models.TextField(
        blank=True, help_text="Failure reason when status=FAILED."
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(
        auto_now=True,
        help_text="Touched on every progress save. Lets a stuck/orphaned RUNNING row (worker died mid-import) be told apart from one that's genuinely still working.",
    )
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "import_job"
        indexes = [
            models.Index(fields=["user", "-created_at"], name="idx_import_job_user"),
        ]

    def __str__(self) -> str:
        return f"ImportJob<{self.user.username} {self.status} {self.processed}/{self.total}>"