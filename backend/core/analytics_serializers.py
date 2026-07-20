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
    episodes_watched = serializers.IntegerField()
    episodes_aired = serializers.IntegerField()
    shows_completed = serializers.IntegerField()
    shows_total = serializers.IntegerField()


class HeatmapDaySerializer(serializers.Serializer):
    date = serializers.DateField()
    episodes_watched = serializers.IntegerField()
    minutes_watched = serializers.IntegerField()
    intensity = serializers.IntegerField(
        help_text="0–4 heat level for the cell colour (0=none, 4=max)."
    )


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
