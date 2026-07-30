import pytest
from unittest.mock import patch
from django.core.cache import cache
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import CachedEpisode, CachedShow, MovieCache, MovieWatchState, Watchlist, WatchState

User = get_user_model()


@pytest.fixture(autouse=True)
def clear_cache():
    # Same reasoning as test_watchlist_cache.py's fixture: the
    # recommendations cache (cache_keys.recommendations_cache_key) is
    # process-wide Redis, not per-test-transaction.
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


def _tmdb_show_recommendation_payload(tmdb_id, title):
    return {
        "id": tmdb_id,
        "name": title,
        "poster_path": None,
        "backdrop_path": None,
        "overview": "",
        "vote_average": 7.5,
        "first_air_date": None,
    }


def _tmdb_movie_recommendation_payload(tmdb_id, title):
    return {
        "id": tmdb_id,
        "title": title,
        "poster_path": None,
        "backdrop_path": None,
        "overview": "",
        "vote_average": 7.5,
        "release_date": None,
    }


@pytest.mark.django_db
def test_for_you_requires_auth(api_client):
    response = api_client.get(reverse("recommendations-for-you"), {"type": "tv"})
    assert response.status_code == 401


@pytest.mark.django_db
def test_for_you_requires_type_param(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    response = api_client.get(reverse("recommendations-for-you"))
    assert response.status_code == 400


@pytest.mark.django_db
def test_for_you_rejects_unknown_type(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    response = api_client.get(reverse("recommendations-for-you"), {"type": "music"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_for_you_empty_library_returns_empty_list(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    # No watched shows/movies at all — the view must return early without
    # ever constructing TMDBService, so this needs no TMDB mock to pass.
    response = api_client.get(reverse("recommendations-for-you"), {"type": "tv"})
    assert response.status_code == 200
    assert response.data == []


@pytest.mark.django_db
def test_for_you_excludes_already_tracked_show_and_names_the_seed(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    seed_show = CachedShow.objects.create(tmdb_id=9101, title="Seed Show", status=CachedShow.Status.ENDED)
    seed_ep = CachedEpisode.objects.create(
        show=seed_show, season_number=1, episode_number=1, tmdb_id=91011,
        air_date="2026-01-01", runtime_minutes=30,
    )
    WatchState.objects.create(user=user, episode=seed_ep)

    # Already tracked — TMDB "recommends" it but it must never come back.
    tracked_show = CachedShow.objects.create(tmdb_id=9102, title="Already Tracked Show", status=CachedShow.Status.ENDED)
    Watchlist.objects.create(user=user, show=tracked_show)

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == "/tv/9101/recommendations":
            return {
                "results": [
                    _tmdb_show_recommendation_payload(9102, "Already Tracked Show"),
                    _tmdb_show_recommendation_payload(9103, "New Recommended Show"),
                ]
            }
        return {"results": []}

    with patch("core.services.TMDBService._request", side_effect=fake_request):
        response = api_client.get(reverse("recommendations-for-you"), {"type": "tv"})

    assert response.status_code == 200
    tmdb_ids = [item["tmdb_id"] for item in response.data]
    assert 9103 in tmdb_ids
    assert 9102 not in tmdb_ids
    new_item = next(item for item in response.data if item["tmdb_id"] == 9103)
    assert new_item["media_type"] == "tv"
    assert "Seed Show" in new_item["reason"]


@pytest.mark.django_db
def test_for_you_response_is_cached_across_requests(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    seed_show = CachedShow.objects.create(tmdb_id=9201, title="Cache Seed Show", status=CachedShow.Status.ENDED)
    seed_ep = CachedEpisode.objects.create(
        show=seed_show, season_number=1, episode_number=1, tmdb_id=92011,
        air_date="2026-01-01", runtime_minutes=30,
    )
    WatchState.objects.create(user=user, episode=seed_ep)

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        return {"results": [_tmdb_show_recommendation_payload(9202, "Cached Result Show")]}

    with patch("core.services.TMDBService._request", side_effect=fake_request) as mock_request:
        first = api_client.get(reverse("recommendations-for-you"), {"type": "tv"})
        assert mock_request.call_count == 1
        second = api_client.get(reverse("recommendations-for-you"), {"type": "tv"})
        # Second call served from cache — no additional TMDB call.
        assert mock_request.call_count == 1

    assert first.data == second.data


@pytest.mark.django_db
def test_for_you_movie_type_never_returns_show_seeded_results(api_client, create_user):
    """The bug this phase fixed: a combined tv+movie pool meant switching
    the Discover Hub's segment toggle didn't change what "For You" showed.
    A user who has only watched shows must get an empty movie feed, not
    the show feed re-labelled — movies and shows never share a seed pool."""
    user = create_user()
    api_client.force_authenticate(user=user)

    seed_show = CachedShow.objects.create(tmdb_id=9301, title="Only Watched Show", status=CachedShow.Status.ENDED)
    seed_ep = CachedEpisode.objects.create(
        show=seed_show, season_number=1, episode_number=1, tmdb_id=93011,
        air_date="2026-01-01", runtime_minutes=30,
    )
    WatchState.objects.create(user=user, episode=seed_ep)

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == "/tv/9301/recommendations":
            return {"results": [_tmdb_show_recommendation_payload(9302, "Show Recommendation")]}
        return {"results": []}

    with patch("core.services.TMDBService._request", side_effect=fake_request) as mock_request:
        tv_response = api_client.get(reverse("recommendations-for-you"), {"type": "tv"})
        movie_response = api_client.get(reverse("recommendations-for-you"), {"type": "movie"})

    assert [item["tmdb_id"] for item in tv_response.data] == [9302]
    assert movie_response.data == []
    # No watched movies at all -> the movie branch must never even call TMDB.
    assert all(not call.args[0].startswith("/movie/") for call in mock_request.call_args_list)


@pytest.mark.django_db
def test_for_you_movie_type_excludes_already_tracked_movie(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    seed_movie = MovieCache.objects.create(tmdb_id=9401, title="Seed Movie", vote_average=8.0)
    MovieWatchState.objects.create(user=user, movie=seed_movie)

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == "/movie/9401/recommendations":
            return {"results": [_tmdb_movie_recommendation_payload(9402, "New Recommended Movie")]}
        return {"results": []}

    with patch("core.services.TMDBService._request", side_effect=fake_request):
        response = api_client.get(reverse("recommendations-for-you"), {"type": "movie"})

    assert response.status_code == 200
    assert len(response.data) == 1
    assert response.data[0]["media_type"] == "movie"
    assert response.data[0]["tmdb_id"] == 9402
