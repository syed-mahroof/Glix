"""
backend/core/rewatch_urls.py

URL patterns for the rewatch system (Phase 75.7), included into
core/urls.py via include() — mirrors review_urls.py's own module pattern.
"""

from django.urls import path

from core.rewatch_views import (
    MovieRewatchCreateView,
    RewatchEpisodeToggleView,
    ShowRewatchDetailView,
    ShowRewatchStartView,
)

urlpatterns = [
    path("rewatch/shows/<int:tmdb_id>/", ShowRewatchDetailView.as_view(), name="show-rewatch-detail"),
    path(
        "rewatch/shows/<int:tmdb_id>/start/", ShowRewatchStartView.as_view(), name="show-rewatch-start"
    ),
    path(
        "rewatch/episodes/<int:episode_tmdb_id>/toggle/",
        RewatchEpisodeToggleView.as_view(),
        name="rewatch-episode-toggle",
    ),
    path("rewatch/movies/<int:tmdb_id>/", MovieRewatchCreateView.as_view(), name="movie-rewatch"),
]
