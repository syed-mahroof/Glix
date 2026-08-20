"""
backend/core/tests/test_catchup_check.py

Regression coverage for CatchupCheckView (POST /watch-state/catchup-check/)
— specifically the "modal reappears after the show already shows complete"
bug (Phase 85, Batch A/E). No dedicated tests existed for this endpoint
before this file.
"""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import CachedEpisode, CachedShow, Watchlist, WatchState

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


def _make_show_with_episodes(tmdb_id, episode_count=3, days_ago=30):
    show = CachedShow.objects.create(tmdb_id=tmdb_id, title=f"Show {tmdb_id}", status=CachedShow.Status.ENDED)
    episodes = [
        CachedEpisode.objects.create(
            tmdb_id=tmdb_id * 100 + n,
            show=show,
            season_number=1,
            episode_number=n,
            title=f"Episode {n}",
            air_date=timezone.now().date() - timedelta(days=days_ago),
            runtime_minutes=20,
        )
        for n in range(1, episode_count + 1)
    ]
    return show, episodes


@pytest.mark.django_db
def test_catchup_check_reports_earlier_unwatched_episodes(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9601, episode_count=3)
    Watchlist.objects.create(user=user, show=show)

    # Nothing watched yet — checking the LAST episode should report the
    # first two as prior unwatched.
    response = api_client.post(
        reverse("watch-state-catchup-check"), {"episode_id": episodes[2].tmdb_id}, format="json"
    )
    assert response.status_code == 200
    assert response.data["has"] is True
    assert set(response.data["ids"]) == {episodes[0].tmdb_id, episodes[1].tmdb_id}
    assert response.data["count"] == 2


@pytest.mark.django_db
def test_catchup_check_returns_nothing_once_everything_prior_is_already_watched(api_client, create_user):
    """
    The exact bug this fix closes: a modal reappearing after the show
    already reads complete. Once every prior episode is genuinely watched,
    the check must report has:false — never re-surface episodes the user
    can already see marked watched.
    """
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9602, episode_count=3)
    Watchlist.objects.create(user=user, show=show)
    for ep in episodes[:2]:
        WatchState.objects.create(user=user, episode=ep)

    response = api_client.post(
        reverse("watch-state-catchup-check"), {"episode_id": episodes[2].tmdb_id}, format="json"
    )
    assert response.status_code == 200
    assert response.data["has"] is False
    assert response.data["ids"] == []
    assert response.data["count"] == 0


@pytest.mark.django_db
def test_catchup_check_short_circuits_when_ignore_catchup_set(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9603, episode_count=2)
    Watchlist.objects.create(user=user, show=show, ignore_catchup=True)

    response = api_client.post(
        reverse("watch-state-catchup-check"), {"episode_id": episodes[1].tmdb_id}, format="json"
    )
    assert response.status_code == 200
    assert response.data == {"has": False, "ids": [], "count": 0}


@pytest.mark.django_db
def test_catchup_check_season_mode_only_flags_earlier_seasons(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=9604, title="Season Mode Show", status=CachedShow.Status.ENDED)
    Watchlist.objects.create(user=user, show=show)

    today = timezone.now().date() - timedelta(days=10)
    season1_ep = CachedEpisode.objects.create(
        tmdb_id=960401, show=show, season_number=1, episode_number=1,
        title="S01E01", air_date=today, runtime_minutes=20,
    )
    CachedEpisode.objects.create(
        tmdb_id=960402, show=show, season_number=2, episode_number=1,
        title="S02E01", air_date=today, runtime_minutes=20,
    )

    response = api_client.post(
        reverse("watch-state-catchup-check"),
        {"show_id": show.tmdb_id, "season_number": 2},
        format="json",
    )
    assert response.status_code == 200
    assert response.data["has"] is True
    assert response.data["ids"] == [season1_ep.tmdb_id]
