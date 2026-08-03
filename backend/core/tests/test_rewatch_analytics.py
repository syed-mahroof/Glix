"""
backend/core/tests/test_rewatch_analytics.py

Phase 75.7 — rewatch minutes/episode-ticks must surface in Analytics
(dashboard "Rewatched" tile, the heatmap, and the daily/weekly/monthly/
yearly statistics buckets) without ever inflating a WatchState-derived
*count* (total_episodes_watched, badges, streak) — those stay rewatch-blind
by construction (RewatchEpisodeState is a separate table entirely).
"""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import CachedEpisode, CachedShow, MovieCache, MovieWatchState, WatchState

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


def _make_show_with_episodes(tmdb_id, episode_count=2, runtime=20):
    show = CachedShow.objects.create(tmdb_id=tmdb_id, title=f"Show {tmdb_id}", status=CachedShow.Status.ENDED)
    episodes = [
        CachedEpisode.objects.create(
            tmdb_id=tmdb_id * 100 + n,
            show=show,
            season_number=1,
            episode_number=n,
            title=f"Episode {n}",
            air_date=timezone.now().date() - timedelta(days=30),
            runtime_minutes=runtime,
        )
        for n in range(1, episode_count + 1)
    ]
    return show, episodes


@pytest.mark.django_db(transaction=True)
def test_dashboard_reports_rewatch_tile_separately_from_total(api_client, create_user):
    """transaction=True is load-bearing here (Phase 75.8): AnalyticsDashboardView
    is now cached, and the rewatch signal busts that cache inside
    transaction.on_commit() — the default django_db wraps each test in a
    transaction it rolls back and never commits, so that hook would simply
    never fire and this would always assert against the first (stale)
    cached response instead of a fresh one. Real requests always commit."""
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9401, episode_count=2, runtime=30)
    # Through the real toggle endpoint, not a direct WatchState.objects.create
    # — total_time_watched is only ever incremented by the view layer's F()
    # update, never by a model-level signal, so a direct ORM create would
    # leave the profile counter at 0 and defeat the point of this test.
    for ep in episodes:
        api_client.post(reverse("watch-state-toggle"), {"episode_id": ep.tmdb_id})

    before = api_client.get(reverse("analytics-dashboard"))
    assert before.data["total_rewatch_minutes_watched"] == 0
    assert before.data["total_minutes_watched"] == 60

    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))

    after = api_client.get(reverse("analytics-dashboard"))
    assert after.data["total_rewatch_minutes_watched"] == 30
    assert after.data["total_rewatch_hours_watched"] == 0.5
    # total_minutes_watched grows to include the rewatch minute — it's the
    # same "how much have I watched, period" total the rest of the app uses.
    assert after.data["total_minutes_watched"] == 90
    # total_episodes_watched (WatchState-derived) must NOT move — a rewatch
    # tick is not a new distinct episode watched.
    assert after.data["total_episodes_watched"] == 2


@pytest.mark.django_db
def test_heatmap_includes_rewatch_activity_for_today(api_client, create_user):
    """Both the original watch and the rewatch tick land on today by
    construction here, so today's cell must reflect the sum of both — this
    is the union working correctly, not double-counting one event."""
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9402, episode_count=1, runtime=25)
    api_client.post(reverse("watch-state-toggle"), {"episode_id": episodes[0].tmdb_id})

    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))

    response = api_client.get(reverse("analytics-heatmap"), {"days": 7})
    assert response.status_code == 200
    today = timezone.now().date().isoformat()
    today_cell = next(cell for cell in response.data if str(cell["date"]) == today)
    assert today_cell["episodes_watched"] == 2
    assert today_cell["minutes_watched"] == 50


@pytest.mark.django_db
def test_heatmap_all_time_includes_rewatch_activity(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9403, episode_count=1, runtime=15)
    WatchState.objects.create(user=user, episode=episodes[0])

    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))

    response = api_client.get(reverse("analytics-heatmap"), {"range": "all"})
    assert response.status_code == 200
    current_year = timezone.now().date().year
    year_bucket = next(y for y in response.data["years"] if y["year"] == current_year)
    # 1 original watch + 1 rewatch tick = 2 episodes_watched for the year.
    assert year_bucket["episodes_watched"] == 2


@pytest.mark.django_db
def test_statistics_daily_bucket_includes_movie_rewatch_minutes(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=9404, title="Movie", runtime_minutes=100)
    MovieWatchState.objects.create(user=user, movie=movie)

    api_client.post(reverse("movie-rewatch", args=[movie.tmdb_id]))

    response = api_client.get(reverse("analytics-statistics"))
    assert response.status_code == 200
    today = timezone.now().date().isoformat()
    today_row = next(row for row in response.data["daily"] if row["period"] == today)
    assert today_row["episodes_watched"] == 1
    assert today_row["minutes_watched"] == 100
