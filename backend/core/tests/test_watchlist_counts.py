"""
backend/core/tests/test_watchlist_counts.py

Phase 75.8 — WatchlistView's aired_episode_count/watched_episode_count/
last_watched_at and ContinueWatchingView's ranking were rewritten from a
single queryset annotated with two Count(..., distinct=True) aggregates
over different relations (a cartesian-join-prone shape) into two flat
grouped queries joined in Python. These pin down that the rewrite produces
byte-identical results to the original per-show semantics.
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


def _make_show_with_episodes(tmdb_id, episode_count=3, runtime=20, days_ago=30):
    show = CachedShow.objects.create(tmdb_id=tmdb_id, title=f"Show {tmdb_id}", status=CachedShow.Status.ENDED)
    episodes = [
        CachedEpisode.objects.create(
            tmdb_id=tmdb_id * 100 + n,
            show=show,
            season_number=1,
            episode_number=n,
            title=f"Episode {n}",
            air_date=timezone.now().date() - timedelta(days=days_ago),
            runtime_minutes=runtime,
        )
        for n in range(1, episode_count + 1)
    ]
    return show, episodes


@pytest.mark.django_db
def test_watchlist_view_reports_correct_aired_watched_and_last_watched(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9501, episode_count=3)
    Watchlist.objects.create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episodes[0])
    latest = WatchState.objects.create(user=user, episode=episodes[1])

    response = api_client.get(reverse("watchlist"), {"page_size": "all"})
    assert response.status_code == 200
    all_entries = (
        response.data["to_watch"]["results"]
        + response.data["up_to_date"]["results"]
        + response.data["archived"]["results"]
    )
    entry = next(e for e in all_entries if e["show"]["tmdb_id"] == show.tmdb_id)
    assert entry["aired_episode_count"] == 3
    assert entry["watched_episode_count"] == 2
    # last_watched_at reflects the most recent WatchState, not the first.
    # response.data holds the pre-render Python value (APIClient doesn't
    # round-trip through JSON), so this compares datetimes directly rather
    # than strings.
    assert entry["last_watched_at"] is not None
    assert entry["last_watched_at"] == latest.watched_at


@pytest.mark.django_db
def test_watchlist_view_zero_counts_for_untouched_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, _episodes = _make_show_with_episodes(9502, episode_count=2)
    Watchlist.objects.create(user=user, show=show)

    response = api_client.get(reverse("watchlist"), {"page_size": "all"})
    assert response.status_code == 200
    entry = response.data["to_watch"]["results"][0]
    assert entry["aired_episode_count"] == 2
    assert entry["watched_episode_count"] == 0
    assert entry["last_watched_at"] is None


@pytest.mark.django_db
def test_continue_watching_includes_started_but_unfinished_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9503, episode_count=3)
    Watchlist.objects.create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episodes[0])

    response = api_client.get(reverse("continue-watching"))
    assert response.status_code == 200
    assert len(response.data) == 1
    row = response.data[0]
    assert row["show"]["tmdb_id"] == show.tmdb_id
    assert row["watched_episode_count"] == 1
    assert row["aired_episode_count"] == 3
    # Next unwatched aired episode is episode 2.
    assert row["next_episode"]["tmdb_id"] == episodes[1].tmdb_id


@pytest.mark.django_db
def test_continue_watching_excludes_fully_watched_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9504, episode_count=2)
    Watchlist.objects.create(user=user, show=show)
    for ep in episodes:
        WatchState.objects.create(user=user, episode=ep)

    response = api_client.get(reverse("continue-watching"))
    assert response.status_code == 200
    assert response.data == []


@pytest.mark.django_db
def test_continue_watching_excludes_untouched_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, _episodes = _make_show_with_episodes(9505, episode_count=2)
    Watchlist.objects.create(user=user, show=show)

    response = api_client.get(reverse("continue-watching"))
    assert response.status_code == 200
    assert response.data == []


@pytest.mark.django_db
def test_continue_watching_excludes_archived_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9506, episode_count=3)
    Watchlist.objects.create(user=user, show=show, status=Watchlist.Status.ARCHIVED)
    WatchState.objects.create(user=user, episode=episodes[0])

    response = api_client.get(reverse("continue-watching"))
    assert response.status_code == 200
    assert response.data == []


@pytest.mark.django_db
def test_continue_watching_orders_by_most_recently_watched(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show_a, episodes_a = _make_show_with_episodes(9507, episode_count=2)
    show_b, episodes_b = _make_show_with_episodes(9508, episode_count=2)
    Watchlist.objects.create(user=user, show=show_a)
    Watchlist.objects.create(user=user, show=show_b)

    now = timezone.now()
    WatchState.objects.create(user=user, episode=episodes_a[0], watched_at=now - timedelta(hours=2))
    WatchState.objects.create(user=user, episode=episodes_b[0], watched_at=now - timedelta(minutes=5))

    response = api_client.get(reverse("continue-watching"))
    assert response.status_code == 200
    tmdb_ids = [row["show"]["tmdb_id"] for row in response.data]
    assert tmdb_ids == [show_b.tmdb_id, show_a.tmdb_id]
