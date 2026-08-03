"""
backend/core/airtime.py

Broadcast air *times* for TV shows, which TMDB does not provide.

TMDB's episode payload carries `air_date` only — a bare calendar date with
no clock time and no timezone. That is why the Upcoming widget's countdown
always counted down to local midnight (hence every countdown ending in
"00m") and why there was no honest way to show TV Time's "9:30 PM" line.

TVmaze fills that gap two ways. Its show record has `schedule.time`
("21:30", the network's local wall clock) plus `network.country.timezone` /
`webChannel.country.timezone` (an IANA zone) — that pair is enough for the
client to render a correct local time for any episode date, DST included,
so we store the pair rather than a resolved instant and let the client
resolve per episode date (see fetch_air_time). But most streaming originals
have no fixed weekly slot, so that pair is often empty — for those,
`/shows/{id}/episodes` carries a per-episode `airstamp` (a full ISO 8601
instant) that exists regardless of a slot. fetch_episode_airstamps() fetches
it and _apply_episode_airstamps() writes it straight to
CachedEpisode.air_datetime as a resolved UTC instant, since there's no
wall-clock/zone pair to keep separate for that source.

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
from dataclasses import dataclass
from datetime import time, timedelta
from typing import Any, Optional

import requests
from django.utils import timezone as dj_timezone
from django.utils.dateparse import parse_datetime

from core.models import CachedEpisode, CachedShow

logger = logging.getLogger(__name__)

TVMAZE_LOOKUP_URL = "https://api.tvmaze.com/lookup/shows"
TVMAZE_EPISODES_URL_TEMPLATE = "https://api.tvmaze.com/shows/{tvmaze_id}/episodes"
TVMAZE_TIMEOUT_SECONDS = 8

# Bounds how far back sync_show_air_time will overwrite CachedEpisode rows
# with a fetched airstamp. A back catalogue can be hundreds of episodes;
# none of them need their exact instant re-verified monthly forever, since
# a past air time only matters for the "aired X days ago" label, which is
# already correct to the day from air_date alone. Recently-aired episodes
# are the ones an in-progress DST transition or schedule correction could
# still affect, so they're the ones worth the write.
AIRSTAMP_BACKFILL_WINDOW = timedelta(days=7)


@dataclass
class AirTimeResult:
    """What TVmaze's /lookup/shows told us, or None per field it didn't."""

    tvmaze_id: Optional[int]
    airs_time: Optional[time]
    airs_timezone: str

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


def fetch_air_time(tvdb_id: Optional[int], imdb_id: Optional[str]) -> Optional[AirTimeResult]:
    """
    Look a show up on TVmaze by external id and return an AirTimeResult.

    None means "unknown show" — 404, network failure, unparseable body —
    the one case a caller must treat as "TVmaze has never heard of this".
    Once a payload is found, an AirTimeResult always comes back (even with
    airs_time=None) so its `tvmaze_id` can be cached and reused by
    fetch_episode_airstamps() without repeating this lookup — a show
    having no fixed weekly slot is not the same as TVmaze not knowing it.
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

    tvmaze_id = payload.get("id")
    if not isinstance(tvmaze_id, int):
        tvmaze_id = None

    schedule = payload.get("schedule")
    airs_time = _parse_hhmm(schedule.get("time")) if isinstance(schedule, dict) else None

    tz_name = _extract_timezone(payload)
    if airs_time is not None and not tz_name:
        # A wall-clock time with no zone is unusable — rendering it in the
        # device's own zone would silently claim a US network's 9:00 PM is
        # the viewer's 9:00 PM. Better to show no time than a wrong one.
        airs_time = None

    return AirTimeResult(tvmaze_id=tvmaze_id, airs_time=airs_time, airs_timezone=tz_name if airs_time else "")


def fetch_episode_airstamps(tvmaze_id: int) -> dict[tuple[int, int], Any]:
    """
    Per-episode exact instants from TVmaze's /shows/{id}/episodes, keyed by
    (season_number, episode_number).

    This is the piece show-level `schedule.time` cannot provide: TVmaze's
    per-episode `airstamp` (full ISO 8601 with offset) is populated even for
    streaming originals with no fixed weekly slot, which is exactly the
    "some shows are missing a release time entirely" gap. Best-effort like
    the rest of this module — returns {} on any failure rather than raising,
    since this rides alongside a show refresh that already did its real work.
    """
    try:
        response = requests.get(
            TVMAZE_EPISODES_URL_TEMPLATE.format(tvmaze_id=tvmaze_id),
            timeout=TVMAZE_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        logger.warning("TVmaze episodes fetch failed for show %s: %s", tvmaze_id, exc)
        return {}

    if response.status_code != 200:
        logger.warning(
            "TVmaze episodes fetch for show %s returned HTTP %s", tvmaze_id, response.status_code
        )
        return {}

    try:
        payload = response.json()
    except ValueError:
        logger.warning("TVmaze episodes fetch for show %s returned non-JSON", tvmaze_id)
        return {}
    if not isinstance(payload, list):
        return {}

    airstamps: dict[tuple[int, int], Any] = {}
    for entry in payload:
        if not isinstance(entry, dict):
            continue
        season_number = entry.get("season")
        episode_number = entry.get("number")
        airstamp = entry.get("airstamp")
        if not isinstance(season_number, int) or not isinstance(episode_number, int):
            continue
        if not isinstance(airstamp, str) or not airstamp:
            continue
        parsed = parse_datetime(airstamp)
        if parsed is None:
            continue
        if dj_timezone.is_naive(parsed):
            parsed = dj_timezone.make_aware(parsed, dj_timezone.utc)
        airstamps[(season_number, episode_number)] = parsed
    return airstamps


def _apply_episode_airstamps(show: CachedShow, airstamps: dict[tuple[int, int], Any]) -> None:
    """
    Bulk-writes CachedEpisode.air_datetime for `show`'s recent episodes,
    matched on (season_number, episode_number) against a freshly-fetched
    airstamp map.

    Bounded to AIRSTAMP_BACKFILL_WINDOW so a 300-episode back catalogue
    isn't rewritten on every monthly recheck — see that constant's docstring.
    """
    cutoff = dj_timezone.now().date() - AIRSTAMP_BACKFILL_WINDOW
    episodes = show.episodes.filter(air_date__gte=cutoff).only(
        "tmdb_id", "season_number", "episode_number", "air_datetime"
    )
    to_update = []
    for episode in episodes:
        instant = airstamps.get((episode.season_number, episode.episode_number))
        if instant is not None and instant != episode.air_datetime:
            episode.air_datetime = instant
            to_update.append(episode)
    if to_update:
        CachedEpisode.objects.bulk_update(to_update, ["air_datetime"])


def sync_show_air_time(show: CachedShow, tvdb_id: Optional[int], imdb_id: Optional[str]) -> bool:
    """
    Refresh `show`'s air-time fields from TVmaze if they're due a check.

    Returns True if a lookup was actually performed (whether or not it
    found anything), False if the existing values were still fresh.
    Always stamps `airtime_checked_at` on a performed lookup so a show
    TVmaze knows nothing about isn't re-queried every six hours forever.

    When the lookup succeeds, also fetches per-episode airstamps and
    writes CachedEpisode.air_datetime / CachedShow.next_episode_air_datetime
    — see fetch_episode_airstamps() and _apply_episode_airstamps().
    """
    now = dj_timezone.now()
    if show.airtime_checked_at and now - show.airtime_checked_at < AIRTIME_RECHECK_AFTER:
        return False

    result = fetch_air_time(tvdb_id, imdb_id)
    update_fields = ["tvmaze_id", "airs_time", "airs_timezone", "airtime_checked_at"]

    if result is None:
        show.tvmaze_id = None
        show.airs_time = None
        show.airs_timezone = ""
    else:
        show.tvmaze_id = result.tvmaze_id
        show.airs_time = result.airs_time
        show.airs_timezone = result.airs_timezone

        if show.tvmaze_id:
            airstamps = fetch_episode_airstamps(show.tvmaze_id)
            if airstamps:
                _apply_episode_airstamps(show, airstamps)
                if show.next_episode_season_number is not None and show.next_episode_number is not None:
                    next_instant = airstamps.get(
                        (show.next_episode_season_number, show.next_episode_number)
                    )
                    if next_instant is not None:
                        show.next_episode_air_datetime = next_instant
                        update_fields.append("next_episode_air_datetime")

    show.airtime_checked_at = now
    show.save(update_fields=update_fields)
    return True
