"""
backend/core/tests/test_discover_prewarm.py

Covers two related Phase 83 perf changes: DiscoverFeedView's new
view-level cache (core/views.py) and the prewarm_discover_caches beat task
(core/tasks.py) that keeps it (and DiscoverGenresView's existing cache)
warm. No live TMDB calls anywhere here — every TMDBService method is
mocked, per the plan's "no live TMDB in the suite" requirement.
"""

from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from core.tasks import prewarm_discover_caches

User = get_user_model()

EMPTY_RESULT = {"results": []}
ONE_GENRE_COVER_RESULT = {
    "results": [{"id": 1, "backdrop_path": "/backdrop.jpg", "poster_path": "/poster.jpg"}]
}


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


# ── DiscoverFeedView view-level cache ───────────────────────────────────────

@pytest.mark.django_db
def test_discover_feed_second_request_is_a_cache_hit(api_client, create_user):
    api_client.force_authenticate(user=create_user())
    url = reverse("discover-feed") + "?type=tv"

    with (
        patch("core.views.TMDBService.get_trending_shows", return_value=EMPTY_RESULT) as mock_trending,
        patch("core.views.TMDBService.get_popular_shows", return_value=EMPTY_RESULT) as mock_popular,
        patch("core.views.TMDBService.get_airing_today_shows", return_value=EMPTY_RESULT) as mock_airing,
    ):
        first = api_client.get(url)
        second = api_client.get(url)

    assert first.status_code == 200
    assert second.status_code == 200
    # The second request must be served entirely from the view-level cache —
    # none of the three TMDB-backed calls should fire a second time.
    mock_trending.assert_called_once()
    mock_popular.assert_called_once()
    mock_airing.assert_called_once()


@pytest.mark.django_db
def test_discover_feed_tv_and_movie_are_cached_independently(api_client, create_user):
    api_client.force_authenticate(user=create_user())

    with (
        patch("core.views.TMDBService.get_trending_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_popular_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_airing_today_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_trending", return_value=EMPTY_RESULT) as mock_movie_trending,
        patch("core.views.TMDBService.get_popular_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_top_rated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_anticipated_movies", return_value=EMPTY_RESULT),
    ):
        tv_response = api_client.get(reverse("discover-feed") + "?type=tv")
        movie_response = api_client.get(reverse("discover-feed") + "?type=movie")

    assert tv_response.data["type"] == "tv"
    assert movie_response.data["type"] == "movie"
    # A shared cache key would have served the tv response back for the
    # movie request instead of ever calling the movie-specific methods.
    mock_movie_trending.assert_called_once()


# ── prewarm_discover_caches beat task ───────────────────────────────────────

@pytest.mark.django_db
def test_prewarm_discover_caches_populates_feed_and_genre_covers_for_both_segments():
    with (
        patch("core.views.TMDBService.get_trending_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_popular_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_airing_today_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_trending", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_popular_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_top_rated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_anticipated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.discover_tv", return_value=ONE_GENRE_COVER_RESULT),
        patch("core.views.TMDBService.discover_movies", return_value=ONE_GENRE_COVER_RESULT),
    ):
        prewarm_discover_caches()

    assert cache.get("discover_feed_tv") is not None
    assert cache.get("discover_feed_movie") is not None
    assert cache.get("discover_genre_covers_tv") is not None
    assert cache.get("discover_genre_covers_movie") is not None


@pytest.mark.django_db
def test_prewarm_discover_caches_makes_a_real_request_an_instant_cache_hit(api_client, create_user):
    """The actual point of the task: after it runs, a real user's request
    never touches TMDB at all."""
    with (
        patch("core.views.TMDBService.get_trending_shows", return_value=EMPTY_RESULT) as mock_trending,
        patch("core.views.TMDBService.get_popular_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_airing_today_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_trending", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_popular_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_top_rated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_anticipated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.discover_tv", return_value=ONE_GENRE_COVER_RESULT),
        patch("core.views.TMDBService.discover_movies", return_value=ONE_GENRE_COVER_RESULT),
    ):
        prewarm_discover_caches()

        api_client.force_authenticate(user=create_user())
        response = api_client.get(reverse("discover-feed") + "?type=tv")

        assert response.status_code == 200
        # Only the task's own call — none from the live request that followed.
        mock_trending.assert_called_once()


@pytest.mark.django_db
def test_prewarm_discover_caches_one_media_type_failure_does_not_abort_the_other():
    with (
        patch("core.views.TMDBService.get_trending_shows", side_effect=RuntimeError("TMDB down")),
        patch("core.views.TMDBService.get_popular_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_airing_today_shows", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_trending", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_popular_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_top_rated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.get_anticipated_movies", return_value=EMPTY_RESULT),
        patch("core.views.TMDBService.discover_tv", return_value=ONE_GENRE_COVER_RESULT),
        patch("core.views.TMDBService.discover_movies", return_value=ONE_GENRE_COVER_RESULT),
    ):
        # Must not raise, and must still warm everything it can.
        prewarm_discover_caches()

    assert cache.get("discover_feed_tv") is None  # the one that failed
    assert cache.get("discover_feed_movie") is not None
    assert cache.get("discover_genre_covers_tv") is not None
    assert cache.get("discover_genre_covers_movie") is not None
