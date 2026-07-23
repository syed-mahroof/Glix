"""
backend/core/review_urls.py

URL patterns for the show/movie review system (Phase L), included into
core/urls.py via include() so review routing stays self-contained —
mirrors comment_urls.py's own module pattern.
"""

from django.urls import path

from core.review_views import (
    MovieReviewListView,
    MovieReviewView,
    ShowReviewListView,
    ShowReviewView,
)

urlpatterns = [
    path("reviews/shows/", ShowReviewListView.as_view(), name="show-review-list"),
    path("reviews/shows/<int:tmdb_id>/", ShowReviewView.as_view(), name="show-review-detail"),
    path("reviews/movies/", MovieReviewListView.as_view(), name="movie-review-list"),
    path("reviews/movies/<int:tmdb_id>/", MovieReviewView.as_view(), name="movie-review-detail"),
]
