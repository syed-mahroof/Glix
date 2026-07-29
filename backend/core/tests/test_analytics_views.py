import pytest
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import CachedEpisode, CachedShow, WatchState, Watchlist

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


# ── Regression coverage for the fixed AnalyticsAchievementsView bug ────────
# _compute_badge_progress used to build a `completed_shows` queryset that
# filtered an annotated int Count() against the string literal "watched"
# (via a bogus models_aired() helper) — Postgres raises on that comparison,
# so this endpoint 500'd on every real call. The value was never even used
# afterwards. Both blocks were deleted; these tests just assert the views
# come back clean, with and without any tracked data.

@pytest.mark.django_db
def test_achievements_empty_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-achievements"))
    assert response.status_code == 200
    assert isinstance(response.data, list)
    assert len(response.data) > 0


@pytest.mark.django_db
def test_achievements_with_watch_history(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=9001, title="Test Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=90011,
        air_date="2026-01-01", runtime_minutes=42,
    )
    Watchlist.objects.get_or_create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episode)

    response = api_client.get(reverse("analytics-achievements"))
    assert response.status_code == 200


@pytest.mark.django_db
def test_dashboard_empty_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-dashboard"))
    assert response.status_code == 200
    assert response.data["total_shows_tracked"] == 0


@pytest.mark.django_db
def test_dashboard_with_completed_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=9002, title="Completed Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=90021,
        air_date="2026-01-01", runtime_minutes=30,
    )
    Watchlist.objects.get_or_create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episode)

    response = api_client.get(reverse("analytics-dashboard"))
    assert response.status_code == 200
    assert response.data["total_shows_tracked"] == 1
    assert response.data["total_episodes_watched"] == 1
