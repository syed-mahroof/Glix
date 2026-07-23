"""
backend/core/services.py

Thin proxy layer over TMDB v3. Every method checks the local cache
tables first (see models.py) and only reaches out to TMDB when the
cached row is missing or stale, keeping Glix's shared TMDB
API key comfortably under rate limits regardless of user count.
"""

import logging
import re
from datetime import timedelta
from typing import Any, Optional

import requests
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from core.models import CachedEpisode, CachedShow, MovieCache

logger = logging.getLogger(__name__)

TMDB_BASE_URL = "https://api.themoviedb.org/3"
CACHE_TTL = timedelta(hours=12)

WRITER_JOBS = {"Writer", "Story", "Teleplay", "Screenplay"}

# TMDB v3 auth is a bare `api_key` query param (this project's secret is a
# 32-char classic key, not a v4 JWT read-access token — the two are not
# interchangeable, so this cannot simply move to `Authorization: Bearer`).
# urllib3's own retry logger logs the full request URL — key included — on
# every retried request (`Retrying (...) after connection broken by ...:
# /3/find/372264?api_key=<real key>&...`), landing in plaintext in any log
# aggregator. Redact it at the logger, not by silencing the warning
# entirely — the retry signal itself is still useful diagnostically.
_API_KEY_PATTERN = re.compile(r"(api_key=)[^&\s]+")


class _RedactApiKeyFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str) and "api_key=" in record.msg:
            record.msg = _API_KEY_PATTERN.sub(r"\1***", record.msg)
        if record.args:
            record.args = tuple(
                _API_KEY_PATTERN.sub(r"\1***", a) if isinstance(a, str) and "api_key=" in a else a
                for a in record.args
            )
        return True


_urllib3_pool_logger = logging.getLogger("urllib3.connectionpool")
if not any(isinstance(f, _RedactApiKeyFilter) for f in _urllib3_pool_logger.filters):
    _urllib3_pool_logger.addFilter(_RedactApiKeyFilter())


class TMDBServiceError(Exception):
    """Raised when TMDB is unreachable AND no local cache fallback exists."""

class TMDBNotFoundError(TMDBServiceError):
    """Raised when TMDB returns a 404."""

class TMDBRateLimitError(TMDBServiceError):
    """Raised when TMDB returns a 429."""


# TMDB has no dedicated "Anime" genre. Documented heuristic (Phase K, mirrors
# client-mobile/lib/anime.ts exactly — one definition, not two): TMDB's
# Animation genre (id 16, same for both /discover/tv and /discover/movie)
# combined with Japanese as the original language.
ANIME_GENRE_ID = 16
ANIME_ORIGINAL_LANGUAGE = "ja"


class TMDBService:
    """
    Usage:
        tmdb = TMDBService()
        show = tmdb.get_show_details(1396)
    """

    def __init__(self, api_key: Optional[str] = None, timeout: int = 10):
        self.api_key = api_key or getattr(settings, "TMDB_API_KEY", None)
        if not self.api_key:
            logger.warning(
                "TMDB_API_KEY is not configured; TMDBService will only "
                "serve from local cache and will raise on cache misses."
            )
        self.timeout = timeout
        
        self.session = requests.Session()
        from requests.adapters import HTTPAdapter
        from urllib3.util.retry import Retry
        # total=4/backoff_factor=1 previously had a worst case of
        # 1+2+4+8=15s of pure backoff sleep alone (urllib3's exponential
        # formula), on top of the actual request time per attempt — easily
        # 15-20s+ for a single TMDB call that keeps hitting 429/5xx. Several
        # views (DiscoverFeedView, movie/show detail's parallel credits/
        # providers/recommendations fetches) make multiple TMDB calls per
        # request, compounding the odds any one of them hits this. That
        # could exceed the frontend's axios timeout (lib/api.ts) even
        # though the backend was still working — surfacing as a raw
        # "Network Error" to the user for what was actually a transient
        # TMDB rate-limit. Tightened to keep worst-case backoff bounded
        # (0.5+1+2=3.5s) while still absorbing a transient blip.
        retry_strategy = Retry(
            total=3,
            status_forcelist=[429, 500, 502, 503, 504],
            allowed_methods=["HEAD", "GET", "OPTIONS"],
            backoff_factor=0.5,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    # ------------------------------------------------------------------
    # Internal request helper
    # ------------------------------------------------------------------
    def _request(self, path: str, params: Optional[dict] = None, use_cache: bool = False, cache_ttl: int = 3600) -> Optional[dict]:
        if not self.api_key:
            return None

        query = {"api_key": self.api_key}
        if params:
            query.update(params)

        cache_key = None
        if use_cache:
            import hashlib
            import json
            # Hash path + params to get stable cache key
            key_str = f"{path}:{json.dumps(params, sort_keys=True)}"
            cache_key = "tmdb_api_" + hashlib.md5(key_str.encode()).hexdigest()
            cached = cache.get(cache_key)
            if cached is not None:
                return cached

        url = f"{TMDB_BASE_URL}{path}"
        try:
            response = self.session.get(url, params=query, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            if use_cache and cache_key:
                cache.set(cache_key, data, timeout=cache_ttl)
            return data
        except requests.exceptions.Timeout:
            logger.error("TMDB request timed out: %s", url)
        except requests.exceptions.HTTPError as exc:
            logger.error("TMDB HTTP error on %s: %s", url, exc)
            if exc.response is not None:
                if exc.response.status_code == 404:
                    raise TMDBNotFoundError("Resource not found on TMDB.")
                if exc.response.status_code == 429:
                    raise TMDBRateLimitError("TMDB rate limit exceeded.")
        except requests.exceptions.RequestException as exc:
            logger.error("TMDB request failed on %s: %s", url, exc)
        return None

    @staticmethod
    def _is_stale(last_synced_at) -> bool:
        return timezone.now() - last_synced_at > CACHE_TTL

    # ------------------------------------------------------------------
    # Shows
    # ------------------------------------------------------------------
    def get_show_details(self, tmdb_id: int) -> CachedShow:
        cached = CachedShow.objects.filter(pk=tmdb_id).first()
        if cached is not None and not self._is_stale(cached.last_synced_at):
            return cached

        payload = self._request(f"/tv/{tmdb_id}", params={"append_to_response": "aggregate_credits,watch/providers"})
        if payload is None:
            if cached is not None:
                logger.info("TMDB unreachable, serving stale cache for show %s", tmdb_id)
                return cached
            raise TMDBServiceError(f"Show {tmdb_id} unavailable from TMDB and not cached.")

        status_map = {
            "Returning Series": CachedShow.Status.RETURNING,
            "Ended": CachedShow.Status.ENDED,
            "Canceled": CachedShow.Status.CANCELED,
            "In Production": CachedShow.Status.IN_PRODUCTION,
        }

        # TMDB knows a season/episode premiere date before that season's
        # individual episodes are otherwise announced (e.g. "Season 4,
        # Episode 1, TBA title, airs in 28 days" with no other Season 4
        # episode data yet) — captured here so a freshly-announced season
        # surfaces in the Upcoming tab without waiting on get_season_episodes()
        # to have cached that season at all.
        next_ep = payload.get("next_episode_to_air") or {}

        show, _ = CachedShow.objects.update_or_create(
            tmdb_id=tmdb_id,
            defaults={
                "title": payload.get("name", ""),
                "overview": payload.get("overview", ""),
                "poster_path": payload.get("poster_path"),
                "backdrop_path": payload.get("backdrop_path"),
                "first_air_date": payload.get("first_air_date") or None,
                "status": status_map.get(payload.get("status"), CachedShow.Status.RETURNING),
                "vote_average": payload.get("vote_average", 0.0),
                "total_seasons": payload.get("number_of_seasons", 0),
                "total_episodes": payload.get("number_of_episodes", 0),
                "original_language": payload.get("original_language", ""),
                "genres": [g["name"] for g in payload.get("genres", [])],
                "next_episode_air_date": next_ep.get("air_date") or None,
                "next_episode_season_number": next_ep.get("season_number"),
                "next_episode_number": next_ep.get("episode_number"),
                "next_episode_name": next_ep.get("name") or None,
            },
        )
        
        if "aggregate_credits" in payload:
            cache.set(f"tmdb_show_credits_{tmdb_id}", payload["aggregate_credits"], timeout=43200)
        if "watch/providers" in payload:
            cache.set(f"tmdb_show_providers_{tmdb_id}", payload["watch/providers"], timeout=43200)

        return show

    def get_show_status(self, tmdb_id: int) -> str:
        return self.get_show_details(tmdb_id).status

    # ------------------------------------------------------------------
    # Movies
    # ------------------------------------------------------------------
    def get_movie_details(self, tmdb_id: int) -> MovieCache:
        """
        Cache-first fetch of TMDB /movie/{id}. Returns a MovieCache
        instance, creating or updating it on a TMDB hit. Falls back to
        stale cache when TMDB is unreachable.
        """
        cached = MovieCache.objects.filter(pk=tmdb_id).first()
        if cached is not None and not self._is_stale(cached.last_synced_at):
            return cached

        payload = self._request(f"/movie/{tmdb_id}", params={"append_to_response": "credits,watch/providers"})
        if payload is None:
            if cached is not None:
                logger.info("TMDB unreachable, serving stale cache for movie %s", tmdb_id)
                return cached
            raise TMDBServiceError(f"Movie {tmdb_id} unavailable from TMDB and not cached.")

        genres = ", ".join(g["name"] for g in payload.get("genres", []))
        movie, _ = MovieCache.objects.update_or_create(
            tmdb_id=tmdb_id,
            defaults={
                "title": payload.get("title", ""),
                "overview": payload.get("overview", ""),
                "poster_path": payload.get("poster_path"),
                "backdrop_path": payload.get("backdrop_path"),
                "release_date": payload.get("release_date") or None,
                "runtime_minutes": payload.get("runtime") or 0,
                "genres_string": genres,
                "vote_average": payload.get("vote_average", 0.0),
                "original_language": payload.get("original_language", ""),
            },
        )
        
        if "credits" in payload:
            cache.set(f"tmdb_movie_credits_{tmdb_id}", payload["credits"], timeout=43200)
        if "watch/providers" in payload:
            cache.set(f"tmdb_movie_providers_{tmdb_id}", payload["watch/providers"], timeout=43200)

        return movie

    # ------------------------------------------------------------------
    def search_shows(self, query: str, page: int = 1) -> dict[str, Any]:
        """
        Lightweight, non-cached TMDB search. Results are transient (the
        user is browsing, not tracking yet), so nothing is written to
        CachedShow until they explicitly add a result to their
        watchlist, which re-fetches full details via get_show_details.
        """
        payload = self._request("/search/tv", params={"query": query, "page": page}, use_cache=True)
        if payload is None:
            raise TMDBServiceError(f"Search for '{query}' failed and has no cache fallback.")

        results = [
            {
                "tmdb_id": item.get("id"),
                "title": item.get("name", ""),
                "overview": item.get("overview", ""),
                "poster_path": item.get("poster_path"),
                "first_air_date": item.get("first_air_date") or None,
                "vote_average": item.get("vote_average", 0.0),
            }
            for item in payload.get("results", [])
        ]
        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": payload.get("total_results", len(results)),
            "results": results,
        }

    # ------------------------------------------------------------------
    # Recommendations (not cached — same reasoning as search_shows)
    # ------------------------------------------------------------------
    def get_recommendations(self, tmdb_show_id: int, page: int = 1) -> dict[str, Any]:
        payload = self._request(f"/tv/{tmdb_show_id}/recommendations", params={"page": page}, use_cache=True)
        if payload is None:
            raise TMDBServiceError(f"Recommendations for show {tmdb_show_id} unavailable.")

        results = [
            {
                "tmdb_id": item.get("id"),
                "title": item.get("name", ""),
                "poster_path": item.get("poster_path"),
                # TMDB always includes these on a recommendation item; kept
                # so app/show/[id].tsx's recommendation cards can pass a
                # complete optimistic-routing param set (title/poster/
                # backdrop/overview/vote_average) to the next show screen,
                # same as every other tap-through entry point in the app.
                "backdrop_path": item.get("backdrop_path"),
                "overview": item.get("overview", ""),
                "vote_average": item.get("vote_average", 0.0),
                "first_air_date": item.get("first_air_date") or None,
            }
            for item in payload.get("results", [])
        ]
        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": payload.get("total_results", len(results)),
            "results": results,
        }

    # ------------------------------------------------------------------
    # Discovery / Feeds (not locally cached)
    # ------------------------------------------------------------------
    def get_trending(
        self,
        media_type: str = "all",
        time_window: str = "day",
        page: int = 1,
        include_genre_ids: bool = False,
        include_original_language: bool = False,
    ) -> dict[str, Any]:
        """
        media_type can be 'all', 'movie', 'tv', 'person'.

        `include_genre_ids`: TMDB's /trending endpoint doesn't accept a
        `with_genres` filter (that's a /discover-only param), but every
        item it returns already carries `genre_ids`. Callers that need to
        filter trending results by genre (DiscoverFilterView) opt into
        keeping that field on each result; existing callers are unaffected
        since it defaults to False and page/total_pages/total_results were
        already silently available in `payload`, just not surfaced before.

        `include_original_language`: same reasoning, for the language/anime
        filters (Phase K) — /trending doesn't accept `with_original_language`
        either, but every item already carries `original_language`.
        """
        payload = self._request(f"/trending/{media_type}/{time_window}", params={"page": page}, use_cache=True)
        if payload is None:
            return {"page": page, "total_pages": 1, "total_results": 0, "results": []}

        results = []
        for item in payload.get("results", []):
            if item.get("media_type") not in ("movie", "tv"):
                continue

            is_movie = item.get("media_type") == "movie"
            entry = {
                "tmdb_id": item.get("id"),
                "media_type": item.get("media_type"),
                "title": item.get("title") if is_movie else item.get("name"),
                "overview": item.get("overview", ""),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "vote_average": item.get("vote_average", 0.0),
                "release_date": item.get("release_date") if is_movie else item.get("first_air_date"),
            }
            if include_genre_ids:
                entry["genre_ids"] = item.get("genre_ids", [])
            if include_original_language:
                entry["original_language"] = item.get("original_language")
            results.append(entry)
        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": payload.get("total_results", len(results)),
            "results": results,
        }

    def get_popular_shows(self, page: int = 1) -> dict[str, Any]:
        payload = self._request("/tv/popular", params={"page": page}, use_cache=True)
        if payload is None:
            return {"results": []}
            
        results = [{
            "tmdb_id": item.get("id"),
            "media_type": "tv",
            "title": item.get("name", ""),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "vote_average": item.get("vote_average", 0.0),
            "release_date": item.get("first_air_date"),
        } for item in payload.get("results", [])]
        return {"results": results}

    def get_popular_movies(self, page: int = 1) -> dict[str, Any]:
        payload = self._request("/movie/popular", params={"page": page}, use_cache=True)
        if payload is None:
            return {"results": []}
            
        results = [{
            "tmdb_id": item.get("id"),
            "media_type": "movie",
            "title": item.get("title", ""),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "vote_average": item.get("vote_average", 0.0),
            "release_date": item.get("release_date"),
        } for item in payload.get("results", [])]
        return {"results": results}

    def get_anticipated_movies(self, page: int = 1) -> dict[str, Any]:
        # Uses /movie/upcoming
        payload = self._request("/movie/upcoming", params={"page": page, "region": "US"}, use_cache=True)
        if payload is None:
            return {"results": []}
            
        results = [{
            "tmdb_id": item.get("id"),
            "media_type": "movie",
            "title": item.get("title", ""),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "vote_average": item.get("vote_average", 0.0),
            "release_date": item.get("release_date"),
        } for item in payload.get("results", [])]
        return {"results": results}

    def get_trending_shows(self, time_window: str = "week", page: int = 1) -> dict[str, Any]:
        """TV-specific trending — cleaner than the 'all' endpoint for the Shows feed."""
        payload = self._request(f"/trending/tv/{time_window}", params={"page": page}, use_cache=True)
        if payload is None:
            return {"results": []}

        results = [{
            "tmdb_id": item.get("id"),
            "media_type": "tv",
            "title": item.get("name", ""),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "vote_average": item.get("vote_average", 0.0),
            "release_date": item.get("first_air_date"),
        } for item in payload.get("results", [])]
        return {"results": results}

    def get_airing_today_shows(self, page: int = 1) -> dict[str, Any]:
        """Shows airing today — used as a dedicated section in the TV feed."""
        payload = self._request("/tv/airing_today", params={"page": page}, use_cache=True)
        if payload is None:
            return {"results": []}

        results = [{
            "tmdb_id": item.get("id"),
            "media_type": "tv",
            "title": item.get("name", ""),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "vote_average": item.get("vote_average", 0.0),
            "release_date": item.get("first_air_date"),
        } for item in payload.get("results", [])]
        return {"results": results}

    def get_top_rated_movies(self, page: int = 1) -> dict[str, Any]:
        """Top rated movies — used as a dedicated section in the Movies feed."""
        payload = self._request("/movie/top_rated", params={"page": page}, use_cache=True)
        if payload is None:
            return {"results": []}

        results = [{
            "tmdb_id": item.get("id"),
            "media_type": "movie",
            "title": item.get("title", ""),
            "overview": item.get("overview", ""),
            "poster_path": item.get("poster_path"),
            "backdrop_path": item.get("backdrop_path"),
            "vote_average": item.get("vote_average", 0.0),
            "release_date": item.get("release_date"),
        } for item in payload.get("results", [])]
        return {"results": results}

    def get_popular_characters(self, limit: int = 40) -> dict[str, Any]:
        """
        TMDB has no standalone "character" entity or dedicated character
        portrait — a character's only image is the credited actor's own
        headshot (`profile_path` on a cast credit). There is no
        `/character/popular` endpoint. This builds a "character" pool (used
        by the Profile avatar picker's "Cast" tab) instead of a "random
        celebrity" pool by pulling top-billed cast off currently trending TV
        shows and popular movies and keeping each entry's `character` name
        rather than the actor's real name — so the picker reads as "pick a
        character from a show," the closest TMDB-backed approximation of
        what was asked for. The underlying photo is unavoidably the actor's
        real headshot; TMDB simply doesn't store anything else.
        """
        characters: list[dict] = []
        seen_profile_paths: set[str] = set()

        tv = self.get_trending_shows(time_window="week", page=1)
        movies = self.get_popular_movies(page=1)
        titles = [{**t, "media_type": "tv"} for t in tv.get("results", [])[:8]] + [
            {**m, "media_type": "movie"} for m in movies.get("results", [])[:8]
        ]

        for title in titles:
            try:
                credits = (
                    self.get_show_credits(title["tmdb_id"])
                    if title["media_type"] == "tv"
                    else self.get_movie_credits(title["tmdb_id"])
                )
            except TMDBServiceError:
                continue

            for member in credits.get("cast", [])[:4]:
                profile_path = member.get("profile_path")
                character = member.get("character")
                if not profile_path or not character or profile_path in seen_profile_paths:
                    continue
                seen_profile_paths.add(profile_path)
                characters.append({
                    "character": character,
                    "show_title": title.get("title", ""),
                    "profile_path": profile_path,
                })
            if len(characters) >= limit:
                break

        return {"results": characters[:limit]}

    def discover_tv(
        self,
        genre_id: Optional[int] = None,
        sort_by: str = "popularity.desc",
        page: int = 1,
        min_vote_count: int = 100,
        original_language: Optional[str] = None,
        require_anime: bool = False,
    ) -> dict[str, Any]:
        """
        GET /discover/tv — genre + sort browsing for the Discover Hub's
        "Filter & Sort" sheet. Distinct from get_trending_shows()/
        get_popular_shows(), which serve the curated feed's fixed sections
        and don't accept genre/sort params — TMDB's /discover endpoint is
        the one that actually supports `with_genres`/`sort_by`/
        `with_original_language`.

        `min_vote_count`: the floor applied when `sort_by` is
        `vote_average.desc` (see the comment below) — configurable so
        DiscoverFilterView's "Critically Acclaimed" sort (Phase K) can
        reuse this same anti-gaming pattern with a stricter floor than
        the default "Top Rated" sort, instead of a second implementation.

        `require_anime`: TMDB has no dedicated "Anime" genre — same
        heuristic as `client-mobile/lib/anime.ts` (Animation genre +
        Japanese original language), expressed here via TMDB's genre ID
        since /discover operates on IDs, not names. When set, ANDs the
        Animation genre (16) onto `genre_id` via TMDB's comma-separated
        `with_genres` (comma = AND, not OR) and forces
        `with_original_language=ja`, overriding any separately-passed
        `original_language` — a real anime is Japanese-language by this
        definition, so honoring a conflicting language pick alongside
        `require_anime` would just return zero results instead of
        silently doing something the caller more likely meant.
        """
        params: dict[str, Any] = {"page": page, "sort_by": sort_by}
        genre_ids = [str(genre_id)] if genre_id else []
        if require_anime:
            genre_ids.append(str(ANIME_GENRE_ID))
            original_language = ANIME_ORIGINAL_LANGUAGE
        if genre_ids:
            params["with_genres"] = ",".join(genre_ids)
        if original_language:
            params["with_original_language"] = original_language
        if sort_by == "vote_average.desc":
            # Without a vote-count floor, TMDB's vote_average sort surfaces
            # obscure titles with a single 10/10 vote ahead of anything
            # actually well-known — a well-documented TMDB API quirk.
            params["vote_count.gte"] = min_vote_count

        payload = self._request("/discover/tv", params=params, use_cache=True)
        if payload is None:
            return {"page": page, "total_pages": 1, "total_results": 0, "results": []}

        results = [
            {
                "tmdb_id": item.get("id"),
                "media_type": "tv",
                "title": item.get("name", ""),
                "overview": item.get("overview", ""),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "vote_average": item.get("vote_average", 0.0),
                "release_date": item.get("first_air_date"),
            }
            for item in payload.get("results", [])
        ]
        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": payload.get("total_results", len(results)),
            "results": results,
        }

    def discover_movies(
        self,
        genre_id: Optional[int] = None,
        sort_by: str = "popularity.desc",
        page: int = 1,
        min_vote_count: int = 100,
        original_language: Optional[str] = None,
        require_anime: bool = False,
    ) -> dict[str, Any]:
        """GET /discover/movie — movie counterpart to discover_tv(). Same
        `min_vote_count`/`original_language`/`require_anime` reasoning."""
        params: dict[str, Any] = {"page": page, "sort_by": sort_by}
        genre_ids = [str(genre_id)] if genre_id else []
        if require_anime:
            genre_ids.append(str(ANIME_GENRE_ID))
            original_language = ANIME_ORIGINAL_LANGUAGE
        if genre_ids:
            params["with_genres"] = ",".join(genre_ids)
        if original_language:
            params["with_original_language"] = original_language
        if sort_by == "vote_average.desc":
            params["vote_count.gte"] = min_vote_count

        payload = self._request("/discover/movie", params=params, use_cache=True)
        if payload is None:
            return {"page": page, "total_pages": 1, "total_results": 0, "results": []}

        results = [
            {
                "tmdb_id": item.get("id"),
                "media_type": "movie",
                "title": item.get("title", ""),
                "overview": item.get("overview", ""),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "vote_average": item.get("vote_average", 0.0),
                "release_date": item.get("release_date"),
            }
            for item in payload.get("results", [])
        ]
        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": payload.get("total_results", len(results)),
            "results": results,
        }

    def search_multi(self, query: str, page: int = 1) -> dict[str, Any]:
        """
        Universal search across both movies and TV shows via TMDB multi-search.
        Filters out 'person' results. Returns a normalized list shape identical
        to the other discover methods so the frontend has one unified interface.
        Includes `popularity` so the client-side relevancy engine can use it.
        """
        payload = self._request("/search/multi", params={"query": query, "page": page}, use_cache=True)
        if payload is None:
            raise TMDBServiceError(f"Universal search for '{query}' failed.")

        results = []
        for item in payload.get("results", []):
            media_type = item.get("media_type")
            if media_type not in ("movie", "tv"):
                continue
            is_movie = media_type == "movie"
            results.append({
                "tmdb_id": item.get("id"),
                "media_type": media_type,
                "title": item.get("title", "") if is_movie else item.get("name", ""),
                "overview": item.get("overview", ""),
                "poster_path": item.get("poster_path"),
                "backdrop_path": item.get("backdrop_path"),
                "vote_average": item.get("vote_average", 0.0),
                "popularity": item.get("popularity", 0.0),
                "release_date": item.get("release_date") if is_movie else item.get("first_air_date"),
            })

        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": payload.get("total_results", len(results)),
            "results": results,
        }



    # ------------------------------------------------------------------
    # Episodes
    # ------------------------------------------------------------------
    def get_season_episodes(self, tmdb_show_id: int, season_number: int) -> list[CachedEpisode]:
        show = self.get_show_details(tmdb_show_id)

        cached_qs = CachedEpisode.objects.filter(show=show, season_number=season_number)
        freshest = cached_qs.order_by("-last_synced_at").first()
        if cached_qs.exists() and freshest is not None and not self._is_stale(
            freshest.last_synced_at
        ):
            return list(cached_qs)

        # A season TMDB genuinely doesn't have (common on TVDB/TMDB numbering
        # mismatches — run_tvtime_import hits this constantly, e.g. a show
        # TVDB numbers as 17 seasons but TMDB only has 1) 404s every time and
        # leaves nothing in CachedEpisode to short-circuit on next time. Without
        # this, reimporting the same TV Time export re-probes every dead season
        # from scratch on every attempt. Negative-cache the miss instead — a
        # season's existence doesn't change day to day the way episode details do.
        not_found_key = f"tmdb_season_404_{tmdb_show_id}_{season_number}"
        if cache.get(not_found_key):
            raise TMDBNotFoundError(f"Season {season_number} of show {tmdb_show_id} not found on TMDB.")

        try:
            payload = self._request(f"/tv/{tmdb_show_id}/season/{season_number}")
        except TMDBNotFoundError:
            cache.set(not_found_key, True, timeout=7 * 24 * 3600)
            raise
        if payload is None:
            if cached_qs.exists():
                logger.info(
                    "TMDB unreachable, serving stale season cache for show %s season %s",
                    tmdb_show_id,
                    season_number,
                )
                return list(cached_qs)
            raise TMDBServiceError(
                f"Season {season_number} of show {tmdb_show_id} unavailable and not cached."
            )

        episodes = []
        for ep in payload.get("episodes", []):
            episode, _ = CachedEpisode.objects.update_or_create(
                tmdb_id=ep["id"],
                defaults={
                    "show": show,
                    "season_number": ep.get("season_number", season_number),
                    "episode_number": ep.get("episode_number", 0),
                    "title": ep.get("name", ""),
                    "overview": ep.get("overview", ""),
                    "air_date": ep.get("air_date") or None,
                    "runtime_minutes": ep.get("runtime") or 0,
                    "still_path": ep.get("still_path"),
                },
            )
            episodes.append(episode)
        return episodes

    # ------------------------------------------------------------------
    # Cast / MVP voting support (per-episode, flat list — MVPVotingSheet)
    # ------------------------------------------------------------------
    def get_episode_credits(
        self, tmdb_show_id: int, season_number: int, episode_number: int
    ) -> list[dict[str, Any]]:
        """
        Returns a lightweight, flat cast list for MVP voting:
        [{"character_id": int, "name": str, "character": str, "profile_path": str}]
        Deliberately unchanged/independent of get_episode_full_credits
        below — MVPVotingSheet.tsx depends on this exact flat shape.
        """
        payload = self._request(
            f"/tv/{tmdb_show_id}/season/{season_number}/episode/{episode_number}/credits"
        )
        if payload is None:
            raise TMDBServiceError(
                f"Credits for {tmdb_show_id} S{season_number}E{episode_number} unavailable."
            )

        cast = []
        for member in payload.get("cast", []) + payload.get("guest_stars", []):
            cast.append(
                {
                    "character_id": member.get("id"),
                    "name": member.get("name", ""),
                    "character": member.get("character", ""),
                    "profile_path": member.get("profile_path"),
                }
            )
        return cast

    def get_episode_full_credits(
        self, tmdb_show_id: int, season_number: int, episode_number: int
    ) -> dict[str, Any]:
        """
        Richer episode-level credits for the Episode Details screen:
        cast and guest_stars kept separate (unlike get_episode_credits,
        which merges them for MVP-voting purposes), plus director(s)/
        writer(s) pulled out of the crew list TMDB also returns on this
        endpoint. A second, independent method rather than changing
        get_episode_credits's shape, since MVPVotingSheet.tsx already
        depends on that one being a flat array.
        """
        payload = self._request(
            f"/tv/{tmdb_show_id}/season/{season_number}/episode/{episode_number}/credits"
        )
        if payload is None:
            raise TMDBServiceError(
                f"Credits for {tmdb_show_id} S{season_number}E{episode_number} unavailable."
            )

        def _member(m: dict) -> dict[str, Any]:
            return {
                "person_id": m.get("id"),
                "name": m.get("name", ""),
                "character": m.get("character", ""),
                "profile_path": m.get("profile_path"),
            }

        cast = [_member(m) for m in payload.get("cast", [])]
        guest_stars = [_member(m) for m in payload.get("guest_stars", [])]
        crew = payload.get("crew", [])
        directors = [c.get("name", "") for c in crew if c.get("job") == "Director"]
        writers = [c.get("name", "") for c in crew if c.get("job") in WRITER_JOBS]

        return {
            "cast": cast,
            "guest_stars": guest_stars,
            "directors": directors,
            "writers": writers,
        }

    # ------------------------------------------------------------------
    # Cast / Crew (show-level, aggregated across all episodes)
    # ------------------------------------------------------------------
    def get_show_credits(self, tmdb_show_id: int) -> dict[str, Any]:
        """
        Show-level cast/crew via TMDB's aggregate_credits (rolls up
        per-episode credits across every season, unlike the plain
        /credits endpoint, which only returns top-level created_by).
        Capped at 25 entries each, sorted by prominence (billing order
        for cast, episode count for crew), since long-running shows can
        return hundreds of aggregate entries.
        """
        cached_payload = cache.get(f"tmdb_show_credits_{tmdb_show_id}")
        payload = cached_payload or self._request(f"/tv/{tmdb_show_id}/aggregate_credits")
        if payload is None:
            raise TMDBServiceError(f"Credits for show {tmdb_show_id} unavailable.")

        cast_entries = sorted(
            payload.get("cast", []), key=lambda item: item.get("order", 999)
        )[:25]
        crew_entries = sorted(
            payload.get("crew", []),
            key=lambda item: item.get("total_episode_count", 0),
            reverse=True,
        )[:25]

        cast = [
            {
                "person_id": member.get("id"),
                "name": member.get("name", ""),
                "profile_path": member.get("profile_path"),
                "character": (member.get("roles") or [{}])[0].get("character", ""),
                "episode_count": (member.get("roles") or [{}])[0].get("episode_count", 0),
            }
            for member in cast_entries
        ]
        crew = [
            {
                "person_id": member.get("id"),
                "name": member.get("name", ""),
                "profile_path": member.get("profile_path"),
                "job": (member.get("jobs") or [{}])[0].get("job", ""),
                "department": member.get("department", ""),
                "episode_count": member.get("total_episode_count", 0),
            }
            for member in crew_entries
        ]
        return {"cast": cast, "crew": crew}

    # ------------------------------------------------------------------
    # Watch providers ("Where to Watch")
    # ------------------------------------------------------------------
    def get_watch_providers(self, tmdb_show_id: int, region: str = "US") -> list[dict[str, Any]]:
        cached_payload = cache.get(f"tmdb_show_providers_{tmdb_show_id}")
        payload = cached_payload or self._request(f"/tv/{tmdb_show_id}/watch/providers")
        if payload is None:
            raise TMDBServiceError(f"Watch providers for show {tmdb_show_id} unavailable.")

        region_data = payload.get("results", {}).get(region, {})
        providers = region_data.get("flatrate", []) + region_data.get("ads", [])
        return [
            {
                "provider_id": p.get("provider_id"),
                "provider_name": p.get("provider_name"),
                "logo_path": p.get("logo_path"),
            }
            for p in providers
        ]

    # ------------------------------------------------------------------
    # External ID Lookup
    # ------------------------------------------------------------------
    def find_by_external_id(self, external_id: str, external_source: str = "tvdb_id") -> dict[str, Any]:
        """
        Lookup items via external IDs (IMDb, TVDB, etc.). Useful for data migration.
        """
        payload = self._request(f"/find/{external_id}", params={"external_source": external_source})
        if payload is None:
            raise TMDBServiceError(f"Lookup for {external_source} {external_id} failed.")
        return payload

    # ------------------------------------------------------------------
    # Movie Credits & Providers (served from the cached credits block
    # populated by get_movie_details via append_to_response)
    # ------------------------------------------------------------------
    def get_movie_credits(self, tmdb_id: int) -> dict[str, Any]:
        """
        Returns top-25 cast and top-15 crew for a movie, drawn from the
        credits block cached during get_movie_details. Falls back to a
        fresh TMDB fetch if the cache miss occurs.
        """
        cached_payload = cache.get(f"tmdb_movie_credits_{tmdb_id}")
        if cached_payload is None:
            payload = self._request(f"/movie/{tmdb_id}/credits")
            if payload is None:
                raise TMDBServiceError(f"Credits for movie {tmdb_id} unavailable.")
            cached_payload = payload
            cache.set(f"tmdb_movie_credits_{tmdb_id}", payload, timeout=43200)

        cast_raw = sorted(
            cached_payload.get("cast", []),
            key=lambda m: m.get("order", 999),
        )[:25]
        crew_raw = cached_payload.get("crew", [])
        director_jobs = {"Director"}
        crew_filtered = [m for m in crew_raw if m.get("job") in {"Director", "Producer", "Screenplay", "Story", "Writer"}][:15]

        cast = [
            {
                "person_id": m.get("id"),
                "name": m.get("name", ""),
                "profile_path": m.get("profile_path"),
                "character": m.get("character", ""),
            }
            for m in cast_raw
        ]
        crew = [
            {
                "person_id": m.get("id"),
                "name": m.get("name", ""),
                "profile_path": m.get("profile_path"),
                "job": m.get("job", ""),
                "department": m.get("department", ""),
            }
            for m in crew_filtered
        ]
        return {"cast": cast, "crew": crew}

    def get_movie_watch_providers(self, tmdb_id: int, region: str = "US") -> list[dict[str, Any]]:
        """Watch providers for a movie, served from cached block or fresh fetch."""
        cached_payload = cache.get(f"tmdb_movie_providers_{tmdb_id}")
        if cached_payload is None:
            payload = self._request(f"/movie/{tmdb_id}/watch/providers")
            if payload is None:
                raise TMDBServiceError(f"Watch providers for movie {tmdb_id} unavailable.")
            cached_payload = payload
            cache.set(f"tmdb_movie_providers_{tmdb_id}", payload, timeout=43200)

        region_data = cached_payload.get("results", {}).get(region, {})
        providers = region_data.get("flatrate", []) + region_data.get("ads", [])
        return [
            {
                "provider_id": p.get("provider_id"),
                "provider_name": p.get("provider_name"),
                "logo_path": p.get("logo_path"),
            }
            for p in providers
        ]

    def get_movie_recommendations(self, tmdb_id: int, page: int = 1) -> dict[str, Any]:
        """Movie recommendations from TMDB, lightly cached."""
        payload = self._request(f"/movie/{tmdb_id}/recommendations", params={"page": page}, use_cache=True)
        if payload is None:
            raise TMDBServiceError(f"Recommendations for movie {tmdb_id} unavailable.")
        results = [
            {
                "tmdb_id": item.get("id"),
                "media_type": "movie",
                "title": item.get("title", ""),
                "poster_path": item.get("poster_path"),
                # TMDB always includes these on a recommendation item; kept
                # so app/movie/[id].tsx's "More Like This" cards can pass a
                # complete optimistic-routing param set (title/poster/
                # backdrop/overview/vote_average) to the next movie screen,
                # same as every other tap-through entry point in the app.
                "backdrop_path": item.get("backdrop_path"),
                "overview": item.get("overview", ""),
                "vote_average": item.get("vote_average", 0.0),
                "release_date": item.get("release_date") or None,
            }
            for item in payload.get("results", [])
        ]
        return {
            "page": payload.get("page", page),
            "total_pages": payload.get("total_pages", 1),
            "total_results": len(results),
            "results": results,
        }