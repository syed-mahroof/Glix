"""
backend/core/airtime.py

Broadcast air *times* for TV shows, which TMDB does not provide.

TMDB's episode payload carries `air_date` only — a bare calendar date with
no clock time and no timezone. That is why the Upcoming widget's countdown
always counted down to local midnight (hence every countdown ending in
"00m") and why there was no honest way to show TV Time's "9:30 PM" line.

TVmaze fills exactly that gap: its show record has
`schedule.time` ("21:30", the network's local wall clock) plus
`network.country.timezone` / `webChannel.country.timezone` (an IANA zone).
That pair is all the client needs to render a correct local time for any
episode date, DST included — so we store the pair rather than a resolved
instant, and let the client resolve per episode date.

Cost control matters here: this runs on a free-tier container that was
already being OOM-killed under load, so it is deliberately *not* on any
user request path. `refresh_show_cache` (Celery, every 6h per RETURNING
show) is the only caller, and `CachedShow.airtime_checked_at` gates it to
roughly one lookup per show per month — including for shows TVmaze has no
schedule for, which would otherwise be re-asked hardest of all.

TVmaze needs no API key and asks for ~20 requests/10s; one call per show
per month spread across a Celery queue is nowhere near that.
"""

import logging
from datetime import time, timedelta
from typing import Any, Optional

import requests
from django.utils import timezone as dj_timezone

from core.models import CachedShow

logger = logging.getLogger(__name__)

TVMAZE_LOOKUP_URL = "https://api.tvmaze.com/lookup/shows"
TVMAZE_TIMEOUT_SECONDS = 8

# A network slot changes very rarely (a season move, a channel switch), and
# a stale slot is a cosmetically-wrong minute label, not a broken feature —
# so re-checking monthly is the right trade against free-tier request budget.
AIRTIME_RECHECK_AFTER = timedelta(days=30)


def _parse_hhmm(raw: Any) -> Optional[time]:
    """TVmaze's `schedule.time` is "HH:MM", or "" for anything without a
    fixed slot (most streaming originals). Anything unparseable is treated
    as "no air time" rather than raising — a bad upstream value must never
    fail the show refresh it is a side-quest of."""
    if not raw or not isinstance(raw, str):
        return None
    parts = raw.split(":")
    if len(parts) != 2:
        return None
    try:
        hour, minute = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    return time(hour=hour, minute=minute)


def _extract_timezone(payload: dict) -> str:
    """The IANA zone the `schedule.time` wall clock belongs to.

    Broadcast shows carry it under `network.country.timezone`; streaming
    ones under `webChannel.country.timezone`. Either key can be present but
    null (TVmaze models a missing country as an explicit null, not an
    absent key), so each hop is guarded rather than chained.
    """
    for key in ("network", "webChannel"):
        channel = payload.get(key)
        if not isinstance(channel, dict):
            continue
        country = channel.get("country")
        if not isinstance(country, dict):
            continue
        tz = country.get("timezone")
        if isinstance(tz, str) and tz:
            return tz
    return ""


def fetch_air_time(tvdb_id: Optional[int], imdb_id: Optional[str]) -> Optional[tuple[time, str]]:
    """
    Look a show up on TVmaze by external id and return its
    (wall-clock air time, IANA timezone) pair, or None.

    None covers every "we don't know" case identically — unknown show,
    no fixed slot, missing timezone, network failure — because the caller
    treats them the same way: record that we checked, store no time.
    Callers must not distinguish them; the widget simply omits the time
    line when there isn't one.
    """
    if tvdb_id:
        params = {"thetvdb": tvdb_id}
    elif imdb_id:
        params = {"imdb": imdb_id}
    else:
        return None

    try:
        response = requests.get(TVMAZE_LOOKUP_URL, params=params, timeout=TVMAZE_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        logger.warning("TVmaze lookup failed for %s: %s", params, exc)
        return None

    # 404 is TVmaze's "no such show", an expected outcome for anything it
    # doesn't cover — not worth a warning line per sweep.
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        logger.warning("TVmaze lookup for %s returned HTTP %s", params, response.status_code)
        return None

    try:
        payload = response.json()
    except ValueError:
        logger.warning("TVmaze lookup for %s returned non-JSON", params)
        return None
    if not isinstance(payload, dict):
        return None

    schedule = payload.get("schedule")
    if not isinstance(schedule, dict):
        return None

    airs_time = _parse_hhmm(schedule.get("time"))
    if airs_time is None:
        return None

    tz_name = _extract_timezone(payload)
    if not tz_name:
        # A wall-clock time with no zone is unusable — rendering it in the
        # device's own zone would silently claim a US network's 9:00 PM is
        # the viewer's 9:00 PM. Better to show no time than a wrong one.
        return None

    return airs_time, tz_name


def sync_show_air_time(show: CachedShow, tvdb_id: Optional[int], imdb_id: Optional[str]) -> bool:
    """
    Refresh `show`'s air-time fields from TVmaze if they're due a check.

    Returns True if a lookup was actually performed (whether or not it
    found anything), False if the existing values were still fresh.
    Always stamps `airtime_checked_at` on a performed lookup so a show
    TVmaze knows nothing about isn't re-queried every six hours forever.
    """
    now = dj_timezone.now()
    if show.airtime_checked_at and now - show.airtime_checked_at < AIRTIME_RECHECK_AFTER:
        return False

    result = fetch_air_time(tvdb_id, imdb_id)
    if result is None:
        show.airs_time = None
        show.airs_timezone = ""
    else:
        show.airs_time, show.airs_timezone = result

    show.airtime_checked_at = now
    show.save(update_fields=["airs_time", "airs_timezone", "airtime_checked_at"])
    return True
