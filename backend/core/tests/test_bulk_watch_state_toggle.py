"""
backend/core/tests/test_bulk_watch_state_toggle.py

Regression coverage for the Cascade Catch-Up ("Mark Season Watched")
bulk-toggle endpoint's badges/streak gap: WatchState.bulk_create is
signal-silent (Django never fires post_save for bulk_create), so
signals.py's evaluate_badges (badges + the day's watch-streak update)
never ran for a batch marked watched through this endpoint, even though
the exact same episodes toggled one at a time through the single-episode
endpoint (WatchStateToggleView, whose post_save signal DOES fire) award
badges/streak correctly. See views.py's BulkWatchStateToggleView docstring
for the full explanation and fix (explicit recalculate_user_badges/
recalculate_watch_streak calls after the bulk_create, mirroring how
tasks.py's run_tvtime_import already works around the identical gap for
its own bulk_create).

test_watchlist_cache.py separately covers this same bulk_create gap's
effect on the watchlist response cache.
"""

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.badge_constants import BADGE_FIRST_EPISODE
from core.models import CachedEpisode, CachedShow, UserProfile, Watchlist, WatchStreak

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
def test_cascade_catch_up_awards_badges_and_reports_them(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=5101, title="Badge Show", status=CachedShow.Status.ENDED)
    episodes = [
        CachedEpisode.objects.create(
            show=show, season_number=1, episode_number=n, tmdb_id=51010 + n,
            air_date="2026-01-01", runtime_minutes=20,
        )
        for n in range(1, 4)
    ]
    Watchlist.objects.create(user=user, show=show)

    response = api_client.post(
        reverse("watch-state-bulk-toggle"),
        {"episode_ids": [ep.tmdb_id for ep in episodes], "watched": True},
        format="json",
    )

    assert response.status_code == 200
    # Without the fix this was always [] — bulk_create's signal silence
    # meant evaluate_badges never ran, so the just-earned badge was invisible
    # both in the response and in the stored profile below.
    assert BADGE_FIRST_EPISODE in response.data["newly_earned_badges"]

    profile = UserProfile.objects.get(user=user)
    assert BADGE_FIRST_EPISODE in profile.earned_badges


@pytest.mark.django_db
def test_cascade_catch_up_updates_todays_watch_streak(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=5102, title="Streak Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=51021,
        air_date="2026-01-01", runtime_minutes=20,
    )
    Watchlist.objects.create(user=user, show=show)

    assert not WatchStreak.objects.filter(user=user).exists()

    response = api_client.post(
        reverse("watch-state-bulk-toggle"),
        {"episode_ids": [episode.tmdb_id], "watched": True},
        format="json",
    )
    assert response.status_code == 200

    # Without the fix no WatchStreak row was ever created for a
    # cascade-only user — recalculate_watch_streak is what creates it.
    streak = WatchStreak.objects.get(user=user)
    assert streak.current_streak == 1
    assert streak.last_watch_date == timezone.now().date()
