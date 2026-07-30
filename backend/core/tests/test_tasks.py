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
from core.tasks import refresh_show_cache, send_weekly_digest

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


# ── Phase 73: refresh_show_cache's "new episode" notification gate ─────────
# The original condition ("air_date == today AND wasn't cached before this
# call") could essentially never be true: TMDB publishes episode rows weeks
# ahead of air date and sync_active_shows re-caches every RETURNING show
# every 6 hours, so by the time an episode's air date actually arrived it
# had always already been cached on some earlier sweep — permanently
# excluding it from its own alert. These tests exercise the replacement
# (CachedEpisode.notified_at) directly against TMDBService._request, the
# same real network boundary test_tvtime_import.py uses, so the assertions
# hold against genuine DB state rather than a mocked shortcut.

def _show_details_payload(tmdb_id, total_seasons=1):
    return {
        "id": tmdb_id,
        "name": f"Show {tmdb_id}",
        "overview": "",
        "poster_path": None,
        "backdrop_path": None,
        "first_air_date": "2020-01-01",
        "status": "Returning Series",
        "vote_average": 8.0,
        "number_of_seasons": total_seasons,
        "number_of_episodes": 1,
        "original_language": "en",
        "genres": [],
    }


@pytest.mark.django_db
def test_refresh_show_cache_notifies_once_for_episode_airing_today():
    tmdb_id = 5001
    today = timezone.now().date()

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == f"/tv/{tmdb_id}":
            return _show_details_payload(tmdb_id)
        if path == f"/tv/{tmdb_id}/season/1":
            return {
                "episodes": [
                    {
                        "id": 50011,
                        "season_number": 1,
                        "episode_number": 1,
                        "name": "Pilot",
                        "overview": "",
                        "air_date": today.isoformat(),
                        "runtime": 30,
                        "still_path": None,
                    }
                ]
            }
        if path == f"/tv/{tmdb_id}/external_ids":
            return {"tvdb_id": None, "imdb_id": None}
        raise AssertionError(f"Unexpected TMDB path in test: {path}")

    with patch("core.services.TMDBService._request", side_effect=fake_request):
        with patch("core.tasks.notify_watchers_of_new_episodes.delay") as mock_delay:
            refresh_show_cache(tmdb_id)

    mock_delay.assert_called_once_with(tmdb_id, [50011])
    episode = CachedEpisode.objects.get(tmdb_id=50011)
    assert episode.notified_at is not None


@pytest.mark.django_db
def test_refresh_show_cache_does_not_renotify_already_notified_episode():
    """The exact bug: an episode cached well before its air date (the
    normal case, since sync_active_shows runs every 6h) must still be
    caught and notified exactly once when its air date arrives, and never
    notified again on a later sweep of the same show."""
    tmdb_id = 5002
    today = timezone.now().date()

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == f"/tv/{tmdb_id}":
            return _show_details_payload(tmdb_id)
        if path == f"/tv/{tmdb_id}/season/1":
            return {
                "episodes": [
                    {
                        "id": 50021,
                        "season_number": 1,
                        "episode_number": 1,
                        "name": "Pilot",
                        "overview": "",
                        "air_date": today.isoformat(),
                        "runtime": 30,
                        "still_path": None,
                    }
                ]
            }
        if path == f"/tv/{tmdb_id}/external_ids":
            return {"tvdb_id": None, "imdb_id": None}
        raise AssertionError(f"Unexpected TMDB path in test: {path}")

    with patch("core.services.TMDBService._request", side_effect=fake_request):
        with patch("core.tasks.notify_watchers_of_new_episodes.delay") as mock_delay:
            refresh_show_cache(tmdb_id)  # first sweep: episode airs today, notify
            refresh_show_cache(tmdb_id)  # second sweep (e.g. 6h later): same day

    mock_delay.assert_called_once_with(tmdb_id, [50021])


@pytest.mark.django_db
def test_refresh_show_cache_syncs_air_time_from_tvmaze():
    tmdb_id = 5003

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == f"/tv/{tmdb_id}":
            return _show_details_payload(tmdb_id)
        if path == f"/tv/{tmdb_id}/season/1":
            return {"episodes": []}
        if path == f"/tv/{tmdb_id}/external_ids":
            return {"tvdb_id": 999, "imdb_id": None}
        raise AssertionError(f"Unexpected TMDB path in test: {path}")

    class _FakeTVmazeResponse:
        status_code = 200

        def json(self):
            return {
                "schedule": {"time": "21:30", "days": ["Monday"]},
                "network": {"country": {"timezone": "America/New_York"}},
            }

    with patch("core.services.TMDBService._request", side_effect=fake_request):
        with patch("core.airtime.requests.get", return_value=_FakeTVmazeResponse()) as mock_get:
            refresh_show_cache(tmdb_id)

    mock_get.assert_called_once()
    show = CachedShow.objects.get(tmdb_id=tmdb_id)
    assert show.airs_time is not None and show.airs_time.strftime("%H:%M") == "21:30"
    assert show.airs_timezone == "America/New_York"
    assert show.airtime_checked_at is not None


@pytest.mark.django_db
def test_refresh_show_cache_air_time_lookup_failure_never_blocks_refresh():
    """A TVmaze outage is a cosmetic loss (no widget air time), never a
    reason to fail the whole show refresh — this is what actually caches
    episodes and drives the new-episode alert above."""
    tmdb_id = 5004

    def fake_request(path, params=None, use_cache=False, cache_ttl=3600):
        if path == f"/tv/{tmdb_id}":
            return _show_details_payload(tmdb_id)
        if path == f"/tv/{tmdb_id}/season/1":
            return {"episodes": []}
        if path == f"/tv/{tmdb_id}/external_ids":
            return {"tvdb_id": 999, "imdb_id": None}
        raise AssertionError(f"Unexpected TMDB path in test: {path}")

    with patch("core.services.TMDBService._request", side_effect=fake_request):
        with patch("core.airtime.requests.get", side_effect=OSError("network down")):
            refresh_show_cache(tmdb_id)  # must not raise

    show = CachedShow.objects.get(tmdb_id=tmdb_id)
    assert show.airs_time is None
