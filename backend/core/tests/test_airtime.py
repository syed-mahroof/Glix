"""
backend/core/tests/test_airtime.py

Direct unit coverage for core/airtime.py's TVmaze parsing/gating logic —
separate from test_tasks.py's refresh_show_cache integration tests, which
exercise this only through the "happy path plus one failure" lens. This
file is where the individual branches (no schedule, no timezone, bad
"HH:MM", 404, non-200, non-JSON, stale-vs-fresh recheck gate) get pinned
down directly against fetch_air_time/sync_show_air_time, since those are
exactly the kind of case a shared integration test would gloss over.
"""

from datetime import datetime, time, timedelta
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone

from core.airtime import (
    AIRTIME_RECHECK_AFTER,
    AirTimeResult,
    fetch_air_time,
    fetch_episode_airstamps,
    sync_show_air_time,
)
from core.models import CachedEpisode, CachedShow


def _response(status_code=200, json_data=None):
    resp = Mock()
    resp.status_code = status_code
    resp.json = Mock(return_value=json_data if json_data is not None else {})
    return resp


def test_fetch_air_time_returns_none_with_no_external_ids():
    assert fetch_air_time(None, None) is None


def test_fetch_air_time_prefers_tvdb_id_over_imdb_id():
    with patch("core.airtime.requests.get", return_value=_response(404)) as mock_get:
        fetch_air_time(tvdb_id=123, imdb_id="tt999")
    assert mock_get.call_args.kwargs["params"] == {"thetvdb": 123}


def test_fetch_air_time_falls_back_to_imdb_id_when_no_tvdb_id():
    with patch("core.airtime.requests.get", return_value=_response(404)) as mock_get:
        fetch_air_time(tvdb_id=None, imdb_id="tt999")
    assert mock_get.call_args.kwargs["params"] == {"imdb": "tt999"}


def test_fetch_air_time_returns_none_on_404():
    with patch("core.airtime.requests.get", return_value=_response(404)):
        assert fetch_air_time(123, None) is None


def test_fetch_air_time_returns_none_on_non_200():
    with patch("core.airtime.requests.get", return_value=_response(500)):
        assert fetch_air_time(123, None) is None


def test_fetch_air_time_returns_none_when_schedule_missing():
    """No usable slot, and no `id` in this payload either — still not the
    same as fetch_air_time's None, which means "TVmaze has never heard of
    this show" (404/network/bad-JSON). A found show with no slot must come
    back as an AirTimeResult with a null tvmaze_id here (since this payload
    happens not to carry one), not the sentinel None itself."""
    payload = {"network": {"country": {"timezone": "America/New_York"}}}
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_air_time(123, None)
    assert result == AirTimeResult(tvmaze_id=None, airs_time=None, airs_timezone="")


def test_fetch_air_time_returns_none_when_schedule_time_blank():
    """Most streaming originals have schedule.time == "" on TVmaze — the
    common case, not an error, and must not be treated as one."""
    payload = {
        "schedule": {"time": "", "days": []},
        "network": {"country": {"timezone": "America/New_York"}},
    }
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_air_time(123, None)
    assert result == AirTimeResult(tvmaze_id=None, airs_time=None, airs_timezone="")


def test_fetch_air_time_returns_none_when_time_has_no_timezone():
    """A wall-clock time with nowhere to anchor it is worse than useless —
    rendering it as-is would silently claim it's the viewer's own local
    time. Must come back with airs_time=None, not a naive/UTC guess."""
    payload = {"schedule": {"time": "21:00", "days": ["Monday"]}}
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_air_time(123, None)
    assert result == AirTimeResult(tvmaze_id=None, airs_time=None, airs_timezone="")


def test_fetch_air_time_reads_webchannel_timezone_for_streaming_shows():
    """Broadcast shows carry their timezone under `network`; streaming
    originals carry it under `webChannel` instead — both are real TVmaze
    response shapes and must both resolve."""
    payload = {
        "schedule": {"time": "15:00", "days": ["Friday"]},
        "network": None,
        "webChannel": {"country": {"timezone": "America/Los_Angeles"}},
    }
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_air_time(123, None)
    assert result == AirTimeResult(
        tvmaze_id=None, airs_time=time(15, 0), airs_timezone="America/Los_Angeles"
    )


def test_fetch_air_time_surfaces_tvmaze_id_even_with_no_slot():
    """The id must come through whenever TVmaze knows the show at all, even
    with nothing schedulable — fetch_episode_airstamps() needs it precisely
    for slot-less streaming originals, which is the majority of them."""
    payload = {"id": 4321}
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_air_time(123, None)
    assert result == AirTimeResult(tvmaze_id=4321, airs_time=None, airs_timezone="")


def test_fetch_air_time_handles_request_exception():
    import requests

    with patch("core.airtime.requests.get", side_effect=requests.ConnectionError("down")):
        assert fetch_air_time(123, None) is None


@pytest.mark.django_db
def test_sync_show_air_time_writes_resolved_slot_and_stamps_checked_at():
    show = CachedShow.objects.create(tmdb_id=7001, title="Test Show")
    payload = {
        "schedule": {"time": "20:00", "days": ["Sunday"]},
        "network": {"country": {"timezone": "America/New_York"}},
    }
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        performed = sync_show_air_time(show, tvdb_id=42, imdb_id=None)

    show.refresh_from_db()
    assert performed is True
    assert show.airs_time == time(20, 0)
    assert show.airs_timezone == "America/New_York"
    assert show.airtime_checked_at is not None


@pytest.mark.django_db
def test_sync_show_air_time_skips_lookup_when_recently_checked():
    """The monthly recheck gate — a show checked an hour ago must not
    trigger a second TVmaze call, which is the whole point of storing
    airtime_checked_at at all (bounding TVmaze request volume to roughly
    one call per show per month across the whole 6-hourly refresh sweep)."""
    show = CachedShow.objects.create(
        tmdb_id=7002, title="Recently Checked Show", airtime_checked_at=timezone.now()
    )
    with patch("core.airtime.requests.get") as mock_get:
        performed = sync_show_air_time(show, tvdb_id=42, imdb_id=None)

    mock_get.assert_not_called()
    assert performed is False


@pytest.mark.django_db
def test_sync_show_air_time_rechecks_after_the_recheck_window_elapses():
    show = CachedShow.objects.create(
        tmdb_id=7003,
        title="Stale Check Show",
        airtime_checked_at=timezone.now() - AIRTIME_RECHECK_AFTER - timedelta(days=1),
    )
    payload = {
        "schedule": {"time": "19:00", "days": ["Wednesday"]},
        "network": {"country": {"timezone": "Europe/London"}},
    }
    with patch("core.airtime.requests.get", return_value=_response(200, payload)) as mock_get:
        performed = sync_show_air_time(show, tvdb_id=42, imdb_id=None)

    mock_get.assert_called_once()
    show.refresh_from_db()
    assert performed is True
    assert show.airs_timezone == "Europe/London"


@pytest.mark.django_db
def test_sync_show_air_time_clears_stale_slot_when_tvmaze_no_longer_has_one():
    """A show that used to have a known slot but no longer resolves one
    (cancelled series, schedule pulled) must have its stale fields cleared,
    not left showing an air time that's no longer accurate."""
    show = CachedShow.objects.create(
        tmdb_id=7004,
        title="Now Unscheduled Show",
        airs_time=time(20, 0),
        airs_timezone="America/New_York",
        airtime_checked_at=timezone.now() - AIRTIME_RECHECK_AFTER - timedelta(days=1),
    )
    with patch("core.airtime.requests.get", return_value=_response(404)):
        sync_show_air_time(show, tvdb_id=42, imdb_id=None)

    show.refresh_from_db()
    assert show.airs_time is None
    assert show.airs_timezone == ""


def test_fetch_episode_airstamps_parses_per_episode_instants():
    """The piece show-level schedule.time can't provide: a per-episode
    airstamp, present even for a slot-less streaming original."""
    payload = [
        {"season": 1, "number": 1, "airstamp": "2026-01-15T21:00:00-05:00"},
        {"season": 1, "number": 2, "airstamp": "2026-01-22T21:00:00-05:00"},
    ]
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_episode_airstamps(4321)
    assert result[(1, 1)] == datetime.fromisoformat("2026-01-15T21:00:00-05:00")
    assert result[(1, 2)] == datetime.fromisoformat("2026-01-22T21:00:00-05:00")


def test_fetch_episode_airstamps_skips_entries_missing_an_airstamp():
    """TVmaze can list an announced-but-undated episode with a null
    airstamp — must be skipped, not crash the whole fetch."""
    payload = [
        {"season": 2, "number": 1, "airstamp": None},
        {"season": 2, "number": 2, "airstamp": "2026-03-01T20:00:00Z"},
    ]
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        result = fetch_episode_airstamps(4321)
    assert (2, 1) not in result
    assert (2, 2) in result


def test_fetch_episode_airstamps_returns_empty_on_failure():
    with patch("core.airtime.requests.get", return_value=_response(500)):
        assert fetch_episode_airstamps(4321) == {}


@pytest.mark.django_db
def test_sync_show_air_time_writes_episode_air_datetime_from_airstamps():
    """The full chain: a lookup that resolves a tvmaze_id must also fetch
    and bulk-write per-episode air_datetime for that show's recent episodes,
    matched on (season_number, episode_number) — this is what fixes a show
    with a missing release time end to end, not just the show-level slot."""
    show = CachedShow.objects.create(tmdb_id=7005, title="Airstamp Show")
    episode = CachedEpisode.objects.create(
        tmdb_id=70051,
        show=show,
        season_number=1,
        episode_number=1,
        title="Pilot",
        air_date=timezone.now().date(),
    )
    lookup_payload = {"id": 555, "schedule": {"time": "", "days": []}}
    episodes_payload = [{"season": 1, "number": 1, "airstamp": "2026-01-15T21:00:00-05:00"}]

    def fake_get(url, params=None, timeout=None):
        if "lookup" in url:
            return _response(200, lookup_payload)
        return _response(200, episodes_payload)

    with patch("core.airtime.requests.get", side_effect=fake_get):
        sync_show_air_time(show, tvdb_id=42, imdb_id=None)

    show.refresh_from_db()
    episode.refresh_from_db()
    assert show.tvmaze_id == 555
    assert episode.air_datetime == datetime.fromisoformat("2026-01-15T21:00:00-05:00")


@pytest.mark.django_db
def test_sync_show_air_time_does_not_backfill_episodes_outside_the_window():
    """AIRSTAMP_BACKFILL_WINDOW bounds the write to recent episodes — a
    300-episode back catalogue must not be rewritten on every monthly
    recheck, so an old episode's air_datetime must stay untouched."""
    show = CachedShow.objects.create(tmdb_id=7006, title="Old Episode Show")
    old_episode = CachedEpisode.objects.create(
        tmdb_id=70061,
        show=show,
        season_number=1,
        episode_number=1,
        title="Ancient Pilot",
        air_date=timezone.now().date() - timedelta(days=365),
    )
    lookup_payload = {"id": 556, "schedule": {"time": "", "days": []}}
    episodes_payload = [{"season": 1, "number": 1, "airstamp": "2025-01-15T21:00:00-05:00"}]

    def fake_get(url, params=None, timeout=None):
        if "lookup" in url:
            return _response(200, lookup_payload)
        return _response(200, episodes_payload)

    with patch("core.airtime.requests.get", side_effect=fake_get):
        sync_show_air_time(show, tvdb_id=42, imdb_id=None)

    old_episode.refresh_from_db()
    assert old_episode.air_datetime is None
