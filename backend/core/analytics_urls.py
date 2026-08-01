"""
backend/core/analytics_urls.py

URL patterns for all analytics endpoints. Included from core/urls.py
with the same pattern used for comment_urls.py.
"""

from django.urls import path

from core.analytics_views import (
    AnalyticsAchievementsView,
    AnalyticsCompletionView,
    AnalyticsDashboardView,
    AnalyticsGenresView,
    AnalyticsHeatmapView,
    AnalyticsMonthlySummaryView,
    AnalyticsMoviesView,
    AnalyticsMVPCharactersView,
    AnalyticsProvidersView,
    AnalyticsStatisticsView,
    AnalyticsStreakView,
    AnalyticsYearReviewView,
)

urlpatterns = [
    path("analytics/dashboard/", AnalyticsDashboardView.as_view(), name="analytics-dashboard"),
    path("analytics/statistics/", AnalyticsStatisticsView.as_view(), name="analytics-statistics"),
    path("analytics/genres/", AnalyticsGenresView.as_view(), name="analytics-genres"),
    # Renamed from analytics/actors/ (AnalyticsActorsView) — see the view's
    # own docstring. Zero consumers referenced the old path, so no redirect
    # or dual-registration was needed.
    path("analytics/mvp-characters/", AnalyticsMVPCharactersView.as_view(), name="analytics-mvp-characters"),
    path("analytics/providers/", AnalyticsProvidersView.as_view(), name="analytics-providers"),
    path("analytics/completion/", AnalyticsCompletionView.as_view(), name="analytics-completion"),
    path("analytics/movies/", AnalyticsMoviesView.as_view(), name="analytics-movies"),
    path("analytics/heatmap/", AnalyticsHeatmapView.as_view(), name="analytics-heatmap"),
    path("analytics/streak/", AnalyticsStreakView.as_view(), name="analytics-streak"),
    path("analytics/year-review/", AnalyticsYearReviewView.as_view(), name="analytics-year-review"),
    path("analytics/monthly-summary/", AnalyticsMonthlySummaryView.as_view(), name="analytics-monthly-summary"),
    path("analytics/achievements/", AnalyticsAchievementsView.as_view(), name="analytics-achievements"),
]
