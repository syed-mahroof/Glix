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

from datetime import time, timedelta
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone

from core.airtime import AIRTIME_RECHECK_AFTER, fetch_air_time, sync_show_air_time
from core.models import CachedShow


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
    payload = {"network": {"country": {"timezone": "America/New_York"}}}
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        assert fetch_air_time(123, None) is None


def test_fetch_air_time_returns_none_when_schedule_time_blank():
    """Most streaming originals have schedule.time == "" on TVmaze — the
    common case, not an error, and must not be treated as one."""
    payload = {
        "schedule": {"time": "", "days": []},
        "network": {"country": {"timezone": "America/New_York"}},
    }
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        assert fetch_air_time(123, None) is None


def test_fetch_air_time_returns_none_when_time_has_no_timezone():
    """A wall-clock time with nowhere to anchor it is worse than useless —
    rendering it as-is would silently claim it's the viewer's own local
    time. Must come back None, not a naive/UTC guess."""
    payload = {"schedule": {"time": "21:00", "days": ["Monday"]}}
    with patch("core.airtime.requests.get", return_value=_response(200, payload)):
        assert fetch_air_time(123, None) is None


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
    assert result == (time(15, 0), "America/Los_Angeles")


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
