"""Bounded release rails with regional provenance and independent fallbacks."""

from datetime import date, timedelta
import logging

import requests
from django.conf import settings
from django.utils import timezone

from core.cache_utils import safe_cache_get, safe_cache_set
from core.models import CachedEpisode, CachedShow
from core.services import TMDBService, TMDBServiceError

logger = logging.getLogger(__name__)
RAIL_CAP = 40
FRESH_SECONDS = 30 * 60
BACKUP_SECONDS = 6 * 60 * 60


def cached_tvmaze_releases(region, provider_ids, monetization):
    """Use exact TVmaze episode instants already synced by core.airtime.

    Only cached regional provider evidence qualifies. A show's original
    network does not prove streaming availability in the selected country.
    This path adds no external requests to an interactive rail fetch.
    """
    now = timezone.now()
    show_ids = list(CachedEpisode.objects.filter(
        air_datetime__gte=now - timedelta(days=30), air_datetime__lte=now,
        air_datetime_estimated=False, show__air_time_source="tvmaze_exact",
    ).order_by().values_list("show_id", flat=True).distinct()[:RAIL_CAP])
    items = []
    access = set(monetization.split("|"))
    for show in CachedShow.objects.filter(pk__in=show_ids).order_by("-vote_average", "pk"):
        payload = safe_cache_get(f"tmdb_show_providers_{show.pk}")
        if not payload:
            continue
        providers = TMDBService._regional_providers(payload, region)
        if not any((not provider_ids or provider["provider_id"] in provider_ids)
                   and access.intersection(provider["access_types"]) for provider in providers):
            continue
        items.append({
            "tmdb_id": show.pk, "media_type": "tv", "title": show.title,
            "overview": show.overview, "poster_path": show.poster_path,
            "backdrop_path": show.backdrop_path, "vote_average": show.vote_average,
            "release_date": show.first_air_date.isoformat() if show.first_air_date else None,
            "release_source": "tvmaze",
        })
    return items


def watchmode_releases(media_type, region, provider_ids, monetization):
    """Optional free calendar supplement. Its dates are primarily US-only.

    Do not substitute those dates for IN or other regional digital dates,
    or silently bypass selected access/platform filters. A free key can be
    configured server-side without adding an app dependency or paid endpoint.
    """
    key = getattr(settings, "WATCHMODE_API_KEY", "")
    if not key or media_type != "movie" or region != "US" or provider_ids or monetization != "flatrate|free|ads|rent|buy":
        return []
    today = timezone.now().date()
    cache_key = f"watchmode_releases:{today.isoformat()}"
    cached = safe_cache_get(cache_key)
    if cached is not None:
        return cached
    try:
        response = requests.get("https://api.watchmode.com/v1/releases/", headers={"X-API-Key": key},
            params={"start_date": (today - timedelta(days=30)).strftime("%Y%m%d"),
                    "end_date": today.strftime("%Y%m%d"), "limit": 100}, timeout=4)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("releases"), list):
            return []
        items = []
        for release in payload["releases"]:
            if not isinstance(release, dict) or release.get("tmdb_type") != "movie":
                continue
            try:
                released = date.fromisoformat(release.get("source_release_date", ""))
            except (ValueError, TypeError):
                continue
            tmdb_id = release.get("tmdb_id")
            if not isinstance(tmdb_id, int) or tmdb_id <= 0 or not today - timedelta(days=30) <= released <= today:
                continue
            items.append({"tmdb_id": tmdb_id, "media_type": "movie", "title": release.get("title", ""),
                "overview": "", "poster_path": None, "backdrop_path": None, "vote_average": 0,
                "release_date": released.isoformat(), "release_source": "watchmode"})
        safe_cache_set(cache_key, items, timeout=24 * 60 * 60)
        return items
    except (requests.RequestException, ValueError):
        logger.warning("Watchmode release calendar unavailable; retaining other release sources.")
        return []


def recent_release_items(tmdb, media_type, region, provider_ids, monetization):
    provider_ids = tuple(sorted(set(provider_ids)))
    key = f"release_rail:v2:{media_type}:{region}:{','.join(map(str, provider_ids))}:{monetization}"
    cached = safe_cache_get(key)
    if cached is not None:
        return cached
    discover = tmdb.discover_movies if media_type == "movie" else tmdb.discover_tv
    kwargs = dict(watch_region=region, provider_ids=provider_ids, monetization=monetization, recent_releases=True)
    items = []
    available = False
    try:
        first = discover(**kwargs)
        available = True
        items.extend({**item, "release_source": "tmdb"} for item in first["results"])
        if first.get("total_pages", 1) > 1:
            try:
                items.extend({**item, "release_source": "tmdb"} for item in discover(page=2, **kwargs)["results"])
            except TMDBServiceError:
                pass  # Page one's confirmed releases remain usable.
    except TMDBServiceError:
        pass
    if media_type == "tv":
        items.extend(cached_tvmaze_releases(region, provider_ids, monetization))
    items.extend(watchmode_releases(media_type, region, provider_ids, monetization))
    unique = {}
    for item in items:
        unique.setdefault((item["media_type"], item["tmdb_id"]), item)
    result = {"items": list(unique.values())[:RAIL_CAP], "is_stale": False,
              "fetched_at": timezone.now().isoformat()}
    if not available and not unique:
        backup = safe_cache_get(key + ":backup")
        if backup is not None:
            return {**backup, "is_stale": True}
        raise TMDBServiceError("Recent streaming releases are temporarily unavailable.")
    # A successful empty catalogue is authoritative; never resurrect removed
    # items from a backup when an upstream actually answered with no matches.
    safe_cache_set(key, result, timeout=FRESH_SECONDS)
    safe_cache_set(key + ":backup", result, timeout=BACKUP_SECONDS)
    return result
