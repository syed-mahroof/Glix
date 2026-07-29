import pytest
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

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
def test_resync_stats_recomputes_drifted_total_time_watched(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=7001, title="Resync Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=70011,
        air_date="2026-01-01", runtime_minutes=45,
    )
    Watchlist.objects.create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episode)

    movie = MovieCache.objects.create(tmdb_id=7002, title="Resync Movie", runtime_minutes=100)
    MovieWatchlist.objects.create(user=user, movie=movie)
    MovieWatchState.objects.create(user=user, movie=movie)

    # Simulate drift: the running counter disagrees with ground truth
    # (45 + 100 = 145), e.g. from a partial import failure.
    profile, _ = UserProfile.objects.get_or_create(user=user)
    profile.total_time_watched = 9999
    profile.save(update_fields=["total_time_watched"])

    response = api_client.post(reverse("profile-resync-stats"))
    assert response.status_code == 200
    assert response.data["total_time_watched"] == 145
    assert response.data["shows_count"] == 1
    assert response.data["movies_count"] == 1

    profile.refresh_from_db()
    assert profile.total_time_watched == 145


@pytest.mark.django_db
def test_resync_stats_zero_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    response = api_client.post(reverse("profile-resync-stats"))
    assert response.status_code == 200
    assert response.data["total_time_watched"] == 0
    assert response.data["shows_count"] == 0
    assert response.data["movies_count"] == 0


@pytest.mark.django_db
def test_resync_stats_requires_auth(api_client):
    response = api_client.post(reverse("profile-resync-stats"))
    assert response.status_code == 401
