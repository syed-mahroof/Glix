"""
backend/core/models.py

Core relational schema for Glix.
Optimized for PostgreSQL: explicit indexes, unique constraints, and
ArrayField usage for lightweight tag/badge storage without extra join tables.
"""

import uuid

from django.conf import settings
from django.contrib.postgres.fields import ArrayField
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
    earned_badges = ArrayField(
        base_field=models.CharField(max_length=64),
        default=list,
        blank=True,
        help_text="Slugs of unlocked milestone badges, e.g. 'binge_master', 'anime_fan'.",
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
    # TMDB's /tv/{id} payload includes a `next_episode_to_air` object whenever
    # TMDB knows a premiere date, even before that season's individual
    # episodes are otherwise cached (e.g. a freshly-announced new season with
    # only a premiere date confirmed, no per-episode data yet). Storing it
    # directly on the show lets the Upcoming tab surface a real countdown for
    # a watchlisted show's next season/episode without waiting on
    # get_season_episodes() to have cached that season at all — see
    # lib/upcoming.ts's buildUpcomingItems().
    next_episode_air_date = models.DateField(null=True, blank=True)
    next_episode_season_number = models.PositiveIntegerField(null=True, blank=True)
    next_episode_number = models.PositiveIntegerField(null=True, blank=True)
    next_episode_name = models.CharField(max_length=255, null=True, blank=True)
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
    runtime_minutes = models.PositiveIntegerField(
        default=0,
        help_text="Used to increment/decrement UserProfile.total_time_watched on toggle.",
    )
    still_path = models.CharField(max_length=255, null=True, blank=True)
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
            "wrong place to put it. Cleared once the run finishes."
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
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "import_job"
        indexes = [
            models.Index(fields=["user", "-created_at"], name="idx_import_job_user"),
        ]

    def __str__(self) -> str:
        return f"ImportJob<{self.user.username} {self.status} {self.processed}/{self.total}>"