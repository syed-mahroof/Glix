"""
backend/core/analytics_serializers.py

Plain DRF Serializer (not ModelSerializer) classes for all Analytics
endpoint response shapes. These are data-transfer objects only — no
model writes happen through them.
"""

from rest_framework import serializers


class WatchTimeSummarySerializer(serializers.Serializer):
    total_minutes = serializers.IntegerField()
    total_hours = serializers.FloatField()
    total_days = serializers.FloatField()
    avg_minutes_per_day = serializers.FloatField()
    avg_minutes_per_week = serializers.FloatField()
    avg_minutes_per_month = serializers.FloatField()


class DashboardSerializer(serializers.Serializer):
    total_episodes_watched = serializers.IntegerField()
    total_shows_tracked = serializers.IntegerField()
    total_minutes_watched = serializers.IntegerField()
    total_hours_watched = serializers.FloatField()
    total_days_watched = serializers.FloatField()
    current_streak = serializers.IntegerField()
    longest_streak = serializers.IntegerField()
    total_streak_days = serializers.IntegerField()
    badges_earned = serializers.IntegerField()
    shows_completed = serializers.IntegerField()
    shows_archived = serializers.IntegerField()
    watch_time = WatchTimeSummarySerializer()
    # Phase 75.7 — the "Rewatched" tile. A subset already counted inside
    # total_minutes_watched above, not additional time on top of it; see
    # UserProfile.total_rewatch_time_watched's own help_text.
    total_rewatch_minutes_watched = serializers.IntegerField()
    total_rewatch_hours_watched = serializers.FloatField()


class PeriodStatSerializer(serializers.Serializer):
    period = serializers.CharField()   # e.g. "2025-01" or "Mon" or "2025-W01"
    label = serializers.CharField()    # human-readable label
    episodes_watched = serializers.IntegerField()
    minutes_watched = serializers.IntegerField()


class StatisticsSerializer(serializers.Serializer):
    watch_time = WatchTimeSummarySerializer()
    daily = PeriodStatSerializer(many=True)
    weekly = PeriodStatSerializer(many=True)
    monthly = PeriodStatSerializer(many=True)
    yearly = PeriodStatSerializer(many=True)
    top_shows = serializers.ListField(child=serializers.DictField())
    most_watched_day = serializers.CharField(allow_null=True)


class GenreStatSerializer(serializers.Serializer):
    genre = serializers.CharField()
    episodes_watched = serializers.IntegerField()
    shows_watched = serializers.IntegerField()
    percentage = serializers.FloatField()


class ActorStatSerializer(serializers.Serializer):
    actor_name = serializers.CharField()
    vote_count = serializers.IntegerField()


class CompletionSerializer(serializers.Serializer):
    episode_completion_pct = serializers.FloatField()
    season_completion_pct = serializers.FloatField()
    show_completion_pct = serializers.FloatField()
    # Phase 74: was hardcoded 0.0 in the view AND absent from this
    # serializer (DRF silently dropped it even after the view stopped
    # hardcoding it) — the client's Movies ring rendered a confident
    # falsehood. movies_watched/movies_tracked are watched-or-not counts,
    # not episode-style partial progress — a movie has no "50% complete".
    movie_completion_pct = serializers.FloatField()
    movies_watched = serializers.IntegerField()
    movies_tracked = serializers.IntegerField()
    episodes_watched = serializers.IntegerField()
    episodes_aired = serializers.IntegerField()
    shows_completed = serializers.IntegerField()
    shows_total = serializers.IntegerField()


class LongestMovieSerializer(serializers.Serializer):
    tmdb_id = serializers.IntegerField()
    title = serializers.CharField()
    poster_path = serializers.CharField(allow_null=True)
    runtime_minutes = serializers.IntegerField()


class MovieGenreStatSerializer(serializers.Serializer):
    genre = serializers.CharField()
    count = serializers.IntegerField()
    percentage = serializers.FloatField()


class DecadeStatSerializer(serializers.Serializer):
    decade = serializers.CharField()
    count = serializers.IntegerField()


class RecentMovieSerializer(serializers.Serializer):
    tmdb_id = serializers.IntegerField()
    title = serializers.CharField()
    poster_path = serializers.CharField(allow_null=True)
    watched_at = serializers.DateTimeField()


class AnalyticsMoviesSerializer(serializers.Serializer):
    movies_watched = serializers.IntegerField()
    movies_tracked = serializers.IntegerField()
    completion_pct = serializers.FloatField()
    total_runtime_minutes = serializers.IntegerField()
    average_runtime_minutes = serializers.FloatField()
    watched_this_year = serializers.IntegerField()
    longest_movie = LongestMovieSerializer(allow_null=True)
    top_genres = MovieGenreStatSerializer(many=True)
    by_decade = DecadeStatSerializer(many=True)
    recent_movies = RecentMovieSerializer(many=True)


class HeatmapDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    episodes_watched = serializers.IntegerField()
    minutes_watched = serializers.IntegerField()
    intensity = serializers.IntegerField(
        help_text="0–4 heat level for the cell colour (0=none, 4=max)."
    )


class HeatmapYearSerializer(serializers.Serializer):
    year = serializers.IntegerField()
    episodes_watched = serializers.IntegerField()
    minutes_watched = serializers.IntegerField()
    days_active = serializers.IntegerField()
    max_episodes_in_a_day = serializers.IntegerField()
    days = HeatmapDaySerializer(many=True)


class HeatmapAllTimeSerializer(serializers.Serializer):
    years = HeatmapYearSerializer(many=True)


class StreakSerializer(serializers.Serializer):
    current_streak = serializers.IntegerField()
    longest_streak = serializers.IntegerField()
    total_streak_days = serializers.IntegerField()
    last_watch_date = serializers.DateField(allow_null=True)
    recent_activity = HeatmapDaySerializer(many=True)   # last 30 days


class YearReviewSerializer(serializers.Serializer):
    year = serializers.IntegerField()
    hours_watched = serializers.FloatField()
    episodes_watched = serializers.IntegerField()
    shows_finished = serializers.IntegerField()
    most_watched_show = serializers.DictField(allow_null=True)
    favorite_genre = serializers.CharField(allow_null=True)
    favorite_actor = serializers.CharField(allow_null=True)
    longest_streak = serializers.IntegerField()
    biggest_month = serializers.CharField(allow_null=True)
    biggest_week = serializers.CharField(allow_null=True)
    top_shows = serializers.ListField(child=serializers.DictField())
    top_genres = serializers.ListField(child=serializers.DictField())


class MonthlySummaryItemSerializer(serializers.Serializer):
    month = serializers.CharField()        # "2025-01"
    label = serializers.CharField()        # "January 2025"
    hours_watched = serializers.FloatField()
    episodes_watched = serializers.IntegerField()
    shows_finished = serializers.IntegerField()
    top_genre = serializers.CharField(allow_null=True)
    top_show = serializers.DictField(allow_null=True)


class AchievementItemSerializer(serializers.Serializer):
    slug = serializers.CharField()
    label = serializers.CharField()
    description = serializers.CharField()
    icon = serializers.CharField()
    category = serializers.CharField()
    earned = serializers.BooleanField()
    progress = serializers.FloatField(
        help_text="0.0–1.0 fraction towards earning this badge (1.0 if earned)."
    )
    progress_label = serializers.CharField(
        help_text="Human-readable progress string, e.g. '47 / 100 episodes'."
    )
