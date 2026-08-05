"""
backend/core/serializers.py

DRF ModelSerializers for Glix. Read-heavy fields (progress
percentages, watched flags, human-readable time breakdowns) are
computed via SerializerMethodField so the mobile client never has to
duplicate that arithmetic.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.utils import timezone
from rest_framework import serializers

from core.models import (
    CachedEpisode,
    CachedShow,
    CustomList,
    CustomListItem,
    EpisodeInteraction,
    ImportJob,
    MovieCache,
    MovieWatchlist,
    MovieWatchState,
    UserProfile,
    Watchlist,
    WatchState,
    NotificationPreference,
)

User = get_user_model()
_username_validator = UnicodeUsernameValidator()


class UserProfileSerializer(serializers.ModelSerializer):
    # source="user.username" is writable (Phase 74) — DRF's nested source
    # builds validated_data["user"] = {"username": ...} on write, which
    # update() below pops and saves onto the related User row. email stays
    # read_only: no verification flow exists for changing it, out of scope.
    username = serializers.CharField(source="user.username", max_length=150)
    email = serializers.EmailField(source="user.email", read_only=True)
    watched_days = serializers.SerializerMethodField()
    watched_hours = serializers.SerializerMethodField()
    watched_minutes = serializers.SerializerMethodField()
    # Phase 74 — index-only counts on the Follow table so the Profile
    # social bar's Followers/Following cells get real numbers without a
    # second network request; this endpoint is already fetched on every
    # Profile focus.
    follower_count = serializers.SerializerMethodField()
    following_count = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "username",
            "email",
            "profile_picture",
            "is_private",
            "total_time_watched",
            "watched_days",
            "watched_hours",
            "watched_minutes",
            "earned_badges",
            "follower_count",
            "following_count",
            "created_at",
        ]
        read_only_fields = ["id", "total_time_watched", "earned_badges", "created_at"]

    def get_follower_count(self, obj: UserProfile) -> int:
        return obj.user.incoming_follows.count()

    def get_following_count(self, obj: UserProfile) -> int:
        return obj.user.outgoing_follows.count()

    def validate_username(self, value: str) -> str:
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Username cannot be blank.")
        try:
            _username_validator(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        qs = User.objects.filter(username__iexact=value)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.user_id)
        if qs.exists():
            raise serializers.ValidationError("That username is already taken.")
        return value

    def update(self, instance, validated_data):
        user_data = validated_data.pop("user", None)
        if user_data and "username" in user_data:
            instance.user.username = user_data["username"]
            try:
                instance.user.save(update_fields=["username"])
            except IntegrityError:
                # validate_username's iexact pre-check has a TOCTOU race
                # window — two concurrent renames landing on the exact
                # same username can both pass it before either commits.
                # User.username's DB-level unique constraint is the real
                # backstop; without this catch, the second save's
                # IntegrityError would propagate as an unhandled 500
                # instead of the same "already taken" 400 the pre-check
                # normally returns.
                raise serializers.ValidationError(
                    {"username": ["That username is already taken."]}
                )
        return super().update(instance, validated_data)

    def get_watched_days(self, obj: UserProfile) -> int:
        return obj.total_time_watched // 1440

    def get_watched_hours(self, obj: UserProfile) -> int:
        return (obj.total_time_watched % 1440) // 60

    def get_watched_minutes(self, obj: UserProfile) -> int:
        return obj.total_time_watched % 60


class CachedEpisodeSerializer(serializers.ModelSerializer):
    is_watched = serializers.SerializerMethodField()

    class Meta:
        model = CachedEpisode
        fields = [
            "tmdb_id",
            "show",
            "season_number",
            "episode_number",
            "title",
            "overview",
            "air_date",
            "air_datetime",
            "runtime_minutes",
            "still_path",
            "is_watched",
        ]

    def get_is_watched(self, obj: CachedEpisode) -> bool:
        # `prefetched_watch_states` is set by views.py via Prefetch(to_attr=...)
        # scoped to request.user, avoiding an N+1 query per episode row.
        prefetched = getattr(obj, "prefetched_watch_states", None)
        if prefetched is not None:
            return len(prefetched) > 0

        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        return WatchState.objects.filter(user=request.user, episode=obj).exists()


# The subset of CachedEpisodeSerializer's fields that any *list* consumer
# of an embedded show actually reads. `overview` (a full paragraph per
# episode) and `still_path` are only ever rendered by EpisodeRow.tsx and
# app/episode/[id].tsx, both of which load their episodes from the
# dedicated season/episode endpoints — never from a watchlist entry. On a
# 400+ show library that dead weight was the single largest contributor to
# a multi-megabyte `GET /watchlist/` body. See CachedShowSerializer.
LEAN_EPISODE_FIELDS = (
    "tmdb_id",
    "show_id",
    "season_number",
    "episode_number",
    "title",
    "air_date",
    "air_datetime",
    "runtime_minutes",
)


class CachedShowSerializer(serializers.ModelSerializer):
    episodes = serializers.SerializerMethodField()

    class Meta:
        model = CachedShow
        fields = [
            "tmdb_id",
            "title",
            "overview",
            "poster_path",
            "backdrop_path",
            "first_air_date",
            "status",
            "vote_average",
            "total_seasons",
            "total_episodes",
            "original_language",
            "genres",
            "next_episode_air_date",
            "next_episode_air_datetime",
            "next_episode_season_number",
            "next_episode_number",
            "next_episode_name",
            # The network's broadcast slot, from TVmaze (see core/airtime.py)
            # — TMDB has no air-time data. Sent as the wall-clock time plus
            # its IANA zone rather than a resolved instant, because the
            # correct local time differs per episode date across a DST
            # boundary; the client resolves it per row (lib/dateFormat.ts's
            # formatLocalAirTime). Null/blank whenever TVmaze has no fixed
            # slot for the show, which the client renders as no time line.
            "airs_time",
            "airs_timezone",
            # Which tier resolved airs_time/airs_timezone above — see
            # CachedShow.air_time_source's docstring in models.py for the
            # four possible values. The client uses this to prefix a "~" on
            # a rendered time that's a platform convention rather than a
            # confirmed TVmaze value (lib/dateFormat.ts's formatLocalAirTime),
            # so an estimate is never shown identically to a real time.
            "air_time_source",
            "episodes",
        ]

    def get_episodes(self, obj: CachedShow) -> list:
        """
        Full nested episode objects by default (show detail, search), but a
        pre-built lean list when the caller supplies `episodes_by_show` in
        context.

        WatchlistView builds that map with two flat `.values_list()` queries
        for the *whole* response instead of instantiating ~12,000
        CachedEpisode model objects plus a WatchState prefetch per episode.
        The old path allocated roughly 25,000 Django model instances and
        25,000 DRF serializer instances to render one Shows Hub fetch for a
        large library — the dominant cost of the request, and the reason a
        free-tier container with gunicorn + celery sharing its RAM was being
        OOM-killed ("Instance failed") under it.
        """
        episodes_by_show = self.context.get("episodes_by_show")
        if episodes_by_show is not None:
            return episodes_by_show.get(obj.tmdb_id, [])
        return CachedEpisodeSerializer(
            obj.episodes.all(), many=True, read_only=True, context=self.context
        ).data


class WatchlistSerializer(serializers.ModelSerializer):
    show = CachedShowSerializer(read_only=True)
    watched_episode_count = serializers.SerializerMethodField()
    aired_episode_count = serializers.SerializerMethodField()
    progress_percentage = serializers.SerializerMethodField()
    last_watched_at = serializers.SerializerMethodField()
    active_rewatch = serializers.SerializerMethodField()

    class Meta:
        model = Watchlist
        fields = [
            "id",
            "show",
            "status",
            "is_favorite",
            "ignore_catchup",
            "watched_episode_count",
            "aired_episode_count",
            "progress_percentage",
            "last_watched_at",
            "active_rewatch",
            "added_at",
            "updated_at",
        ]

    def get_last_watched_at(self, obj: Watchlist):
        # Annotated by WatchlistView; null if the user has watched nothing
        # for this show yet. Used by the Shows Hub for recency-aware pill
        # sorting (stalest-first for "Haven't Watched For A While").
        annotated = getattr(obj, "last_watched_at", None)
        if annotated is not None:
            return annotated
        latest = (
            WatchState.objects.filter(user=obj.user, episode__show=obj.show)
            .order_by("-watched_at")
            .values_list("watched_at", flat=True)
            .first()
        )
        return latest

    def get_aired_episode_count(self, obj: Watchlist) -> int:
        # views.py annotates aired_count/watched_count on the queryset for
        # the list endpoint; fall back to a direct query for single-object use.
        annotated = getattr(obj, "aired_count", None)
        if annotated is not None:
            return annotated
        return obj.show.episodes.filter(air_date__lte=timezone.now().date()).count()

    def get_watched_episode_count(self, obj: Watchlist) -> int:
        annotated = getattr(obj, "watched_count", None)
        if annotated is not None:
            return annotated
        return WatchState.objects.filter(user=obj.user, episode__show=obj.show).count()

    def get_active_rewatch(self, obj: Watchlist):
        # WatchlistView builds this dict with two flat queries for the whole
        # response (same technique as episodes_by_show) — never a per-row
        # query. None for any entry with no in-progress rewatch round.
        entry = self.context.get("active_rewatch_by_show", {}).get(obj.show_id)
        if entry is None:
            return None
        return {
            "round_number": entry["round_number"],
            "watched_episode_count": entry["watched_episode_count"],
            "aired_episode_count": self.get_aired_episode_count(obj),
        }

    def get_progress_percentage(self, obj: Watchlist) -> float:
        aired = self.get_aired_episode_count(obj)
        if aired == 0:
            return 0.0
        watched = self.get_watched_episode_count(obj)
        return round((watched / aired) * 100, 1)


class WatchStateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WatchState
        fields = ["id", "user", "episode", "watched_at"]
        read_only_fields = ["id", "watched_at"]


class WatchHistorySerializer(serializers.ModelSerializer):
    """
    Serializer for the reverse-chronological watch history feed.
    Inlines enough episode and show data to render the history row.
    """
    episode = CachedEpisodeSerializer(read_only=True)
    show_id = serializers.IntegerField(source="episode.show.tmdb_id", read_only=True)
    show_title = serializers.CharField(source="episode.show.title", read_only=True)
    show_poster_path = serializers.CharField(source="episode.show.poster_path", read_only=True)

    class Meta:
        model = WatchState
        fields = [
            "id",
            "episode",
            "show_id",
            "show_title",
            "show_poster_path",
            "watched_at",
        ]


class EpisodeInteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = EpisodeInteraction
        fields = [
            "id",
            "user",
            "episode",
            "emotion_emoji",
            "mvp_character_id",
            "mvp_character_name",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ContinueWatchingSerializer(serializers.Serializer):
    """
    Not a ModelSerializer — ContinueWatchingView (views.py) builds a
    plain list of dicts (one per show, paired with its computed "next
    episode to watch"), since no single model row represents that
    combination directly.
    """

    show = CachedShowSerializer(read_only=True)
    next_episode = CachedEpisodeSerializer(read_only=True, allow_null=True, required=False)
    watched_episode_count = serializers.IntegerField(read_only=True)
    aired_episode_count = serializers.IntegerField(read_only=True)
    progress_percentage = serializers.FloatField(read_only=True)
    last_watched_at = serializers.DateTimeField(read_only=True)


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ['push_token', 'notify_new_episode', 'notify_weekly_digest']


class MovieCacheSerializer(serializers.ModelSerializer):
    """
    Read serializer for MovieCache. Exposes is_watched so the mobile
    client can render the checkmark state without a second request.
    """

    is_watched = serializers.SerializerMethodField()

    class Meta:
        model = MovieCache
        fields = [
            "tmdb_id",
            "title",
            "overview",
            "poster_path",
            "backdrop_path",
            "release_date",
            "runtime_minutes",
            "genres_string",
            "vote_average",
            "original_language",
            "is_watched",
        ]

    def get_is_watched(self, obj: MovieCache) -> bool:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        return MovieWatchState.objects.filter(user=request.user, movie=obj).exists()


class MovieWatchlistSerializer(serializers.ModelSerializer):
    """
    Read serializer for MovieWatchlist. Nests the full MovieCache
    (with is_watched) so the mobile client gets everything it needs
    for a MovieRow in a single list response.
    """

    movie = MovieCacheSerializer(read_only=True)
    # Populated via the view's `watch_state_watched_at` Subquery annotation
    # (MovieWatchlistView.get()) — None for entries with no annotation
    # (e.g. any other caller of this serializer that doesn't annotate it).
    watched_at = serializers.SerializerMethodField()
    # Populated via the view's `rewatch_count_annotated` Count annotation —
    # see watched_at's comment above, same convention.
    rewatch_count = serializers.SerializerMethodField()

    class Meta:
        model = MovieWatchlist
        fields = [
            "id",
            "movie",
            "added_at",
            "updated_at",
            "watched_at",
            "rewatch_count",
        ]

    def get_watched_at(self, obj):
        return getattr(obj, "watch_state_watched_at", None)

    def get_rewatch_count(self, obj):
        return getattr(obj, "rewatch_count_annotated", 0)
class ImportJobSerializer(serializers.ModelSerializer):
    """
    Progress + result for one TV Time import run. `payload` is
    deliberately not exposed — it is multi-megabyte staged input, not
    something the client needs back.
    """

    progress = serializers.SerializerMethodField()

    class Meta:
        model = ImportJob
        fields = [
            "id",
            "status",
            "total",
            "processed",
            "progress",
            "shows_imported",
            "shows_skipped",
            "movies_imported",
            "movies_skipped",
            "episodes_marked",
            "errors",
            "detail",
            "created_at",
            "finished_at",
        ]
        read_only_fields = fields

    def get_progress(self, obj: ImportJob) -> float:
        """0.0–1.0, ready for the client's ProgressRing."""
        if not obj.total:
            return 0.0
        return round(min(obj.processed / obj.total, 1.0), 4)


class CustomListItemSerializer(serializers.ModelSerializer):
    """
    title/poster_path come from the view's `cover_map` context (a bulk
    CachedShow/MovieCache lookup keyed by (media_type, tmdb_id)) — never a
    per-item query, so a list with many items stays O(1) queries for covers.
    """

    title = serializers.SerializerMethodField()
    poster_path = serializers.SerializerMethodField()

    class Meta:
        model = CustomListItem
        fields = ["id", "media_type", "tmdb_id", "title", "poster_path", "added_at"]

    def _cover(self, obj):
        return self.context.get("cover_map", {}).get((obj.media_type, obj.tmdb_id), {})

    def get_title(self, obj):
        return self._cover(obj).get("title", "")

    def get_poster_path(self, obj):
        return self._cover(obj).get("poster_path")


class CustomListSerializer(serializers.ModelSerializer):
    """
    item_count/cover_posters read from context maps the view precomputes in
    bulk (one query for all of the user's lists' items, one for covers) —
    never a per-list query, so "My Lists" stays cheap regardless of how
    many lists a user has.
    """

    item_count = serializers.SerializerMethodField()
    tv_count = serializers.SerializerMethodField()
    movie_count = serializers.SerializerMethodField()
    cover_posters = serializers.SerializerMethodField()

    class Meta:
        model = CustomList
        fields = [
            "id", "name", "description", "is_private",
            "item_count", "tv_count", "movie_count", "cover_posters", "created_at", "updated_at",
        ]

    def get_item_count(self, obj):
        counts = self.context.get("item_counts", {})
        return counts.get(obj.id, 0)

    def get_tv_count(self, obj):
        return self.context.get("media_counts", {}).get((obj.id, "tv"), 0)

    def get_movie_count(self, obj):
        return self.context.get("media_counts", {}).get((obj.id, "movie"), 0)

    def get_cover_posters(self, obj):
        cover_map = self.context.get("cover_map", {})
        items = self.context.get("items_by_list", {}).get(obj.id, [])
        posters = []
        for item in items:
            poster = cover_map.get((item.media_type, item.tmdb_id), {}).get("poster_path")
            if poster:
                posters.append(poster)
        return posters[:4]


class ForYouRecommendationSerializer(serializers.Serializer):
    """
    A plain (non-model) serializer: rows come from
    recommendations_views.ForYouRecommendationsView's in-memory merge of
    several TMDB recommendation calls, not a single queryset.
    """

    media_type = serializers.ChoiceField(choices=["tv", "movie"])
    tmdb_id = serializers.IntegerField()
    title = serializers.CharField()
    poster_path = serializers.CharField(allow_null=True)
    backdrop_path = serializers.CharField(allow_null=True)
    overview = serializers.CharField(allow_blank=True)
    vote_average = serializers.FloatField()
    reason = serializers.CharField(help_text="e.g. 'Because you watched Breaking Bad'.")
