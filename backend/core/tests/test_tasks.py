import pytest
from unittest.mock import patch
from datetime import timedelta
from django.contrib.auth import get_user_model
from django.utils import timezone

from core.models import (
    CachedEpisode,
    CachedShow,
    MovieCache,
    MovieWatchState,
    NotificationPreference,
    Watchlist,
    WatchState,
)
from core.tasks import send_weekly_digest

User = get_user_model()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


# ── Phase 71: send_weekly_digest content enrichment ────────────────────────
# The original version only ever reported a raw episode count ("You watched
# N episodes this week") and never looked at MovieWatchState at all. These
# tests assert the richer body: episodes + movies counted together, the
# week's most-watched show named, and episodes airing in the next 7 days
# surfaced — using notify_users' actual call args rather than hitting Expo.

@pytest.mark.django_db
def test_weekly_digest_reports_episodes_movies_and_top_show(create_user):
    user = create_user()
    NotificationPreference.objects.create(
        user=user, push_token="ExponentPushToken[test]", notify_weekly_digest=True
    )

    show = CachedShow.objects.create(tmdb_id=8001, title="Digest Show", status=CachedShow.Status.ENDED)
    ep1 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=80011,
        air_date="2026-01-01", runtime_minutes=30,
    )
    ep2 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=2, tmdb_id=80012,
        air_date="2026-01-02", runtime_minutes=30,
    )
    now = timezone.now()
    WatchState.objects.create(user=user, episode=ep1, watched_at=now)
    WatchState.objects.create(user=user, episode=ep2, watched_at=now)

    movie = MovieCache.objects.create(tmdb_id=8002, title="Digest Movie", runtime_minutes=100)
    MovieWatchState.objects.create(user=user, movie=movie, watched_at=now)

    with patch("core.tasks.notify_users") as mock_notify:
        send_weekly_digest()

    assert mock_notify.call_count == 1
    _, kwargs = mock_notify.call_args
    body = kwargs["body"]
    assert "2 episodes" in body
    assert "1 movie" in body
    assert "Digest Show" in body


@pytest.mark.django_db
def test_weekly_digest_surfaces_upcoming_episode_count(create_user):
    user = create_user()
    NotificationPreference.objects.create(
        user=user, push_token="ExponentPushToken[test]", notify_weekly_digest=True
    )

    show = CachedShow.objects.create(tmdb_id=8003, title="Airing Show", status=CachedShow.Status.RETURNING)
    watched_ep = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=80031,
        air_date="2026-01-01", runtime_minutes=30,
    )
    WatchState.objects.create(user=user, episode=watched_ep, watched_at=timezone.now())
    Watchlist.objects.create(user=user, show=show)

    today = timezone.now().date()
    CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=2, tmdb_id=80032,
        air_date=today + timedelta(days=3), runtime_minutes=30,
    )

    with patch("core.tasks.notify_users") as mock_notify:
        send_weekly_digest()

    _, kwargs = mock_notify.call_args
    assert "1 new episode" in kwargs["body"]
    assert "next 7 days" in kwargs["body"]


@pytest.mark.django_db
def test_weekly_digest_excludes_archived_show_from_upcoming_count(create_user):
    user = create_user()
    NotificationPreference.objects.create(
        user=user, push_token="ExponentPushToken[test]", notify_weekly_digest=True
    )

    show = CachedShow.objects.create(tmdb_id=8004, title="Archived Show", status=CachedShow.Status.RETURNING)
    watched_ep = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=80041,
        air_date="2026-01-01", runtime_minutes=30,
    )
    WatchState.objects.create(user=user, episode=watched_ep, watched_at=timezone.now())
    Watchlist.objects.create(user=user, show=show, status=Watchlist.Status.ARCHIVED)

    today = timezone.now().date()
    CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=2, tmdb_id=80042,
        air_date=today + timedelta(days=3), runtime_minutes=30,
    )

    with patch("core.tasks.notify_users") as mock_notify:
        send_weekly_digest()

    _, kwargs = mock_notify.call_args
    assert "airing in the next 7 days" not in kwargs["body"]


@pytest.mark.django_db
def test_weekly_digest_skips_inactive_user(create_user):
    user = create_user()
    NotificationPreference.objects.create(
        user=user, push_token="ExponentPushToken[test]", notify_weekly_digest=True
    )

    with patch("core.tasks.notify_users") as mock_notify:
        send_weekly_digest()

    mock_notify.assert_not_called()
