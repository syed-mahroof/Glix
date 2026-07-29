"""
backend/core/recommendations_views.py

"For You" recommendations built from the user's whole library, not a
single title. TMDBService.get_recommendations/get_movie_recommendations
already exist (services.py) but are a straight passthrough to TMDB's
per-title /recommendations endpoint — great for "more like this show"
on a detail screen, useless as a personalized home-level feed since it
has no memory of anything else the user has watched.

Approach: pick a small set of "seed" titles from the user's own
strongest signals (most-watched shows by episode count, highest-rated
watched movies), fetch TMDB's per-title recommendations for each seed,
then merge and rank candidates by how many different seeds recommended
them (an item surfaced by three of the user's watched shows is a much
stronger signal than one that only matches a single title) with TMDB's
own vote_average as a tiebreaker. Titles already tracked are excluded.
No new ML/scoring infrastructure — just aggregating existing per-title
calls across the library instead of making just one.
"""

import logging
from collections import Counter, defaultdict

from django.core.cache import cache
from django.db.models import Count
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.cache_keys import RECOMMENDATIONS_CACHE_TTL_SECONDS, recommendations_cache_key
from core.models import MovieWatchlist, MovieWatchState, Watchlist, WatchState
from core.serializers import ForYouRecommendationSerializer
from core.services import TMDBService, TMDBServiceError

logger = logging.getLogger(__name__)

# Each seed is one live TMDB call (cached 1h at the TMDBService layer
# regardless of which user triggers it) — kept small so a cold cache miss
# for one user doesn't fan out into a double-digit request burst.
SHOW_SEED_LIMIT = 3
MOVIE_SEED_LIMIT = 2
RESULT_LIMIT = 20


def _top_watched_shows(user, limit: int) -> list[dict]:
    """Mirrors AnalyticsStatisticsView's top_shows_qs: distinct shows
    ranked by episodes watched, the strongest 'this user is really into
    this show' signal available."""
    rows = (
        WatchState.objects.filter(user=user)
        .values("episode__show__tmdb_id", "episode__show__title")
        .annotate(c=Count("id"))
        .order_by("-c")[:limit]
    )
    return [{"tmdb_id": r["episode__show__tmdb_id"], "title": r["episode__show__title"]} for r in rows]


def _top_watched_movies(user, limit: int) -> list[dict]:
    """MovieWatchState is presence-only (watched or not, no repeat-count
    signal), so rank seeds by the movie's own TMDB rating instead — the
    user's best-reviewed watches are the most representative of taste."""
    rows = (
        MovieWatchState.objects.filter(user=user)
        .select_related("movie")
        .order_by("-movie__vote_average", "-watched_at")[:limit]
    )
    return [{"tmdb_id": r.movie.tmdb_id, "title": r.movie.title} for r in rows]


class ForYouRecommendationsView(APIView):
    """GET /api/recommendations/for-you/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        cache_key = recommendations_cache_key(user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        show_seeds = _top_watched_shows(user, SHOW_SEED_LIMIT)
        movie_seeds = _top_watched_movies(user, MOVIE_SEED_LIMIT)

        if not show_seeds and not movie_seeds:
            # New/empty library: nothing to seed from. Cache the empty
            # result too (short-circuits repeat calls for a brand new
            # user hammering the home screen) at the same TTL.
            cache.set(cache_key, [], timeout=RECOMMENDATIONS_CACHE_TTL_SECONDS)
            return Response([])

        tracked_show_ids = set(Watchlist.objects.filter(user=user).values_list("show_id", flat=True))
        tracked_movie_ids = set(MovieWatchlist.objects.filter(user=user).values_list("movie_id", flat=True))
        seed_show_ids = {s["tmdb_id"] for s in show_seeds}
        seed_movie_ids = {m["tmdb_id"] for m in movie_seeds}

        tmdb = TMDBService()
        # candidate key -> {item, score, reasons}
        candidates: dict[tuple[str, int], dict] = {}

        for seed in show_seeds:
            try:
                payload = tmdb.get_recommendations(seed["tmdb_id"])
            except TMDBServiceError:
                logger.warning("for_you: recommendations unavailable for show seed %s", seed["tmdb_id"])
                continue
            for item in payload.get("results", []):
                tid = item.get("tmdb_id")
                if not tid or tid in tracked_show_ids or tid in seed_show_ids:
                    continue
                key = ("tv", tid)
                entry = candidates.setdefault(key, {"item": item, "score": 0, "seeds": []})
                entry["score"] += 1
                entry["seeds"].append(seed["title"])

        for seed in movie_seeds:
            try:
                payload = tmdb.get_movie_recommendations(seed["tmdb_id"])
            except TMDBServiceError:
                logger.warning("for_you: recommendations unavailable for movie seed %s", seed["tmdb_id"])
                continue
            for item in payload.get("results", []):
                tid = item.get("tmdb_id")
                if not tid or tid in tracked_movie_ids or tid in seed_movie_ids:
                    continue
                key = ("movie", tid)
                entry = candidates.setdefault(key, {"item": item, "score": 0, "seeds": []})
                entry["score"] += 1
                entry["seeds"].append(seed["title"])

        ranked = sorted(
            candidates.items(),
            key=lambda kv: (kv[1]["score"], kv[1]["item"].get("vote_average", 0.0)),
            reverse=True,
        )[:RESULT_LIMIT]

        results = []
        for (media_type, tmdb_id), entry in ranked:
            item = entry["item"]
            seed_titles = entry["seeds"]
            reason = f"Because you watched {seed_titles[0]}"
            other_count = len(seed_titles) - 1
            if other_count > 0:
                reason += f" and {other_count} other{'s' if other_count > 1 else ''}"
            results.append(
                {
                    "media_type": media_type,
                    "tmdb_id": tmdb_id,
                    "title": item.get("title", ""),
                    "poster_path": item.get("poster_path"),
                    "backdrop_path": item.get("backdrop_path"),
                    "overview": item.get("overview", ""),
                    "vote_average": item.get("vote_average", 0.0),
                    "reason": reason,
                }
            )

        serializer = ForYouRecommendationSerializer(results, many=True)
        data = serializer.data
        cache.set(cache_key, data, timeout=RECOMMENDATIONS_CACHE_TTL_SECONDS)
        return Response(data)
