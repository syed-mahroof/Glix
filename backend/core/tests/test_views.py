from unittest.mock import patch

import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model

from core.models import (
    CachedEpisode,
    CachedShow,
    MovieCache,
    MovieWatchlist,
    MovieWatchState,
    UserProfile,
    Watchlist,
    WatchState,
)

User = get_user_model()

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user

@pytest.mark.django_db
def test_login_success(api_client, create_user):
    create_user()
    url = reverse("auth-login")
    response = api_client.post(url, {"username": "testuser", "password": "password"})
    assert response.status_code == 200
    assert "access" in response.data
    assert "refresh" in response.data

@pytest.mark.django_db
def test_login_failure(api_client, create_user):
    create_user()
    url = reverse("auth-login")
    response = api_client.post(url, {"username": "testuser", "password": "wrongpassword"})
    assert response.status_code == 401
    assert "access" not in response.data

@pytest.mark.django_db
def test_watchlist_unauthenticated(api_client):
    url = reverse("watchlist")
    response = api_client.get(url)
    assert response.status_code == 401


# ── Phase F: full-delete Remove from Watchlist ────────────────────────────

@pytest.mark.django_db
def test_show_remove_unauthenticated(api_client):
    url = reverse("watchlist-remove")
    response = api_client.delete(url, {"show_id": 1}, format="json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_show_remove_not_in_watchlist(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=101, title="Untracked Show", status=CachedShow.Status.ENDED)
    url = reverse("watchlist-remove")
    response = api_client.delete(url, {"show_id": show.tmdb_id}, format="json")
    assert response.status_code == 404


@pytest.mark.django_db
def test_show_remove_full_delete(api_client, create_user):
    """Full-delete decision (Phase F): removing a show wipes its
    WatchState rows too, decrements total_time_watched by exactly what
    was watched, and returns everything the frontend needs to restore
    it via Undo — independent of what the client had cached locally."""
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=202, title="Full Delete Show", status=CachedShow.Status.ENDED)
    ep1 = CachedEpisode.objects.create(
        tmdb_id=2021, show=show, season_number=1, episode_number=1,
        title="E1", air_date="2020-01-01", runtime_minutes=30,
    )
    ep2 = CachedEpisode.objects.create(
        tmdb_id=2022, show=show, season_number=1, episode_number=2,
        title="E2", air_date="2020-01-08", runtime_minutes=45,
    )
    entry = Watchlist.objects.create(
        user=user, show=show, status=Watchlist.Status.UP_TO_DATE,
        is_favorite=True, ignore_catchup=True,
    )
    WatchState.objects.create(user=user, episode=ep1)
    WatchState.objects.create(user=user, episode=ep2)
    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.total_time_watched = 200
    profile.save(update_fields=["total_time_watched"])

    url = reverse("watchlist-remove")
    response = api_client.delete(url, {"show_id": show.tmdb_id}, format="json")

    assert response.status_code == 200
    assert set(response.data["watched_episode_ids"]) == {ep1.tmdb_id, ep2.tmdb_id}
    assert response.data["was_favorite"] is True
    assert response.data["was_status"] == Watchlist.Status.UP_TO_DATE
    assert response.data["was_ignore_catchup"] is True
    assert response.data["total_time_watched"] == 200 - 30 - 45

    assert not Watchlist.objects.filter(user=user, show=show).exists()
    assert not WatchState.objects.filter(user=user, episode__show=show).exists()
    profile.refresh_from_db()
    assert profile.total_time_watched == 200 - 30 - 45


@pytest.mark.django_db
def test_movie_remove_unauthenticated(api_client):
    url = reverse("movies-watchlist-remove")
    response = api_client.delete(url, {"movie_id": 1}, format="json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_movie_remove_full_delete(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    movie = MovieCache.objects.create(tmdb_id=303, title="Full Delete Movie", runtime_minutes=120)
    MovieWatchlist.objects.create(user=user, movie=movie)
    MovieWatchState.objects.create(user=user, movie=movie)
    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.total_time_watched = 150
    profile.save(update_fields=["total_time_watched"])

    url = reverse("movies-watchlist-remove")
    response = api_client.delete(url, {"movie_id": movie.tmdb_id}, format="json")

    assert response.status_code == 200
    assert response.data["was_watched"] is True
    assert response.data["total_time_watched"] == 150 - 120

    assert not MovieWatchlist.objects.filter(user=user, movie=movie).exists()
    assert not MovieWatchState.objects.filter(user=user, movie=movie).exists()
    profile.refresh_from_db()
    assert profile.total_time_watched == 150 - 120


# ── Phase K: Discover Hub sort/language/anime wiring ──────────────────────

EMPTY_DISCOVER_RESULT = {"page": 1, "total_pages": 1, "total_results": 0, "results": []}


@pytest.mark.django_db
def test_discover_filter_critically_acclaimed_uses_higher_vote_floor(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    with patch("core.views.TMDBService.discover_tv", return_value=EMPTY_DISCOVER_RESULT) as mock_discover:
        response = api_client.get(url, {"type": "tv", "sort": "critically_acclaimed"})
    assert response.status_code == 200
    kwargs = mock_discover.call_args.kwargs
    assert kwargs["sort_by"] == "vote_average.desc"
    assert kwargs["min_vote_count"] == 1000


@pytest.mark.django_db
def test_discover_filter_top_rated_uses_default_vote_floor(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    with patch("core.views.TMDBService.discover_tv", return_value=EMPTY_DISCOVER_RESULT) as mock_discover:
        response = api_client.get(url, {"type": "tv", "sort": "top_rated"})
    assert response.status_code == 200
    assert mock_discover.call_args.kwargs["min_vote_count"] == 100


@pytest.mark.django_db
def test_discover_filter_language_passthrough(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    with patch("core.views.TMDBService.discover_tv", return_value=EMPTY_DISCOVER_RESULT) as mock_discover:
        response = api_client.get(url, {"type": "tv", "sort": "popular", "language": "ko"})
    assert response.status_code == 200
    kwargs = mock_discover.call_args.kwargs
    assert kwargs["original_language"] == "ko"
    assert kwargs["require_anime"] is False


@pytest.mark.django_db
def test_discover_filter_anime_forces_japanese_language(api_client, create_user):
    """anime=true overrides a conflicting language param with 'ja' (Phase K)
    -- a real anime is Japanese by this app's own heuristic, so honoring a
    different language pick alongside it would just silently zero results."""
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    with patch("core.views.TMDBService.discover_tv", return_value=EMPTY_DISCOVER_RESULT) as mock_discover:
        response = api_client.get(
            url, {"type": "tv", "sort": "popular", "language": "ko", "anime": "true"}
        )
    assert response.status_code == 200
    kwargs = mock_discover.call_args.kwargs
    assert kwargs["original_language"] == "ja"
    assert kwargs["require_anime"] is True


@pytest.mark.django_db
def test_discover_filter_trending_anime_filters_in_python(api_client, create_user):
    """Trending doesn't support with_genres/with_original_language
    server-side -- confirm the anime filter is applied to the already-
    fetched trending results in Python instead of silently degrading to
    unfiltered trending."""
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    fake_trending = {
        "page": 1,
        "total_pages": 1,
        "total_results": 2,
        "results": [
            {
                "tmdb_id": 1, "media_type": "tv", "title": "Real Anime",
                "overview": "", "poster_path": None, "backdrop_path": None,
                "vote_average": 8.0, "release_date": None,
                "genre_ids": [16, 10759], "original_language": "ja",
            },
            {
                "tmdb_id": 2, "media_type": "tv", "title": "Western Cartoon",
                "overview": "", "poster_path": None, "backdrop_path": None,
                "vote_average": 7.0, "release_date": None,
                "genre_ids": [16, 35], "original_language": "en",
            },
        ],
    }
    with patch("core.views.TMDBService.get_trending", return_value=fake_trending) as mock_trending:
        response = api_client.get(url, {"type": "tv", "sort": "trending", "anime": "true"})
    assert response.status_code == 200
    assert mock_trending.call_args.kwargs["include_original_language"] is True
    titles = [r["title"] for r in response.data["results"]]
    assert titles == ["Real Anime"]
    # Temporary fields used only for server-side filtering must not leak
    # into the response the frontend consumes.
    assert "genre_ids" not in response.data["results"][0]
    assert "original_language" not in response.data["results"][0]


@pytest.mark.django_db
def test_discover_filter_genre_and_language_compose(api_client, create_user):
    """genre + language together (Phase K verify requirement: filter
    combinations must compose, not just work in isolation) -- both should
    reach TMDB in the same request rather than one silently overriding
    the other."""
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    with patch("core.views.TMDBService.discover_tv", return_value=EMPTY_DISCOVER_RESULT) as mock_discover:
        response = api_client.get(
            url, {"type": "tv", "sort": "popular", "genre": "18", "language": "ko"}
        )
    assert response.status_code == 200
    kwargs = mock_discover.call_args.kwargs
    assert kwargs["genre_id"] == 18
    assert kwargs["original_language"] == "ko"
    assert kwargs["require_anime"] is False


@pytest.mark.django_db
def test_discover_filter_genre_and_anime_compose(api_client, create_user):
    """genre + anime together should AND both onto with_genres server-side
    (TMDBService.discover_tv), not have anime silently drop the explicit
    genre pick."""
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("discover-filter")
    with patch("core.views.TMDBService.discover_tv", return_value=EMPTY_DISCOVER_RESULT) as mock_discover:
        response = api_client.get(
            url, {"type": "tv", "sort": "popular", "genre": "10759", "anime": "true"}
        )
    assert response.status_code == 200
    kwargs = mock_discover.call_args.kwargs
    assert kwargs["genre_id"] == 10759
    assert kwargs["require_anime"] is True
    assert kwargs["original_language"] == "ja"
