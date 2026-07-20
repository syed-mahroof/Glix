"""
backend/core/serializers.py

DRF ModelSerializers for Glix. Read-heavy fields (progress
percentages, watched flags, human-readable time breakdowns) are
computed via SerializerMethodField so the mobile client never has to
duplicate that arithmetic.
"""

from django.utils import timezone
from rest_framework import serializers

from core.models import (
    CachedEpisode,
    CachedShow,
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


class UserProfileSerializer(serializers.ModelSerializer):
    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    watched_days = serializers.SerializerMethodField()
    watched_hours = serializers.SerializerMethodField()
    watched_minutes = serializers.SerializerMethodField()

    class Meta:
        model = UserProfile
        fields = [
            "id",
            "username",
            "email",
            "profile_picture",
            "total_time_watched",
            "watched_days",
            "watched_hours",
            "watched_minutes",
            "earned_badges",
            "created_at",
        ]
        read_only_fields = ["id", "total_time_watched", "earned_badges", "created_at"]

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


class CachedShowSerializer(serializers.ModelSerializer):
    episodes = CachedEpisodeSerializer(many=True, read_only=True)

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
            "next_episode_season_number",
            "next_episode_number",
            "next_episode_name",
            "episodes",
        ]


class WatchlistSerializer(serializers.ModelSerializer):
    show = CachedShowSerializer(read_only=True)
    watched_episode_count = serializers.SerializerMethodField()
    aired_episode_count = serializers.SerializerMethodField()
    progress_percentage = serializers.SerializerMethodField()
    last_watched_at = serializers.SerializerMethodField()

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

    class Meta:
        model = MovieWatchlist
        fields = [
            "id",
            "movie",
            "added_at",
            "updated_at",
        ]
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
