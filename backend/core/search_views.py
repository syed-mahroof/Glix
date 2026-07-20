"""
backend/core/search_views.py

Read-only TMDB proxy endpoints layered on top of TMDBService's
cache-first methods. These are the views the mobile search screen,
show-detail screen, season screen, and episode-detail screen call
directly.
"""

import re
import unicodedata
from datetime import date

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import CachedEpisode, EpisodeInteraction
from core.serializers import CachedEpisodeSerializer, CachedShowSerializer
from core.services import TMDBService, TMDBServiceError, TMDBNotFoundError, TMDBRateLimitError


# ---------------------------------------------------------------------------
# Search Relevancy Engine
# ---------------------------------------------------------------------------

def _slugify(text: str) -> str:
    """Lower-case, strip punctuation, normalise unicode."""
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^\w\s]", " ", text).lower()


def _relevance_score(item: dict, query_tokens: list[str]) -> float:
    """
    Hybrid score combining title match, popularity, and recency.

    Weights:
      - Exact title match:        +50
      - All tokens in title:      +30
      - Partial token coverage:    +0..+20 (proportional)
      - Popularity bucket:        +0..+15 (log-scaled, TMDB popularty field)
      - Upcoming / new release:   +10 if released in past 6 months or future
      - vote_average bonus:       +0..+5
    """
    title_raw = item.get("title", "")
    title = _slugify(title_raw)
    popularity = float(item.get("popularity", 0) or 0)
    vote_avg = float(item.get("vote_average", 0) or 0)
    release_str = item.get("release_date") or ""

    score = 0.0

    # --- title matching ---
    query_joined = " ".join(query_tokens)
    if query_joined == title.strip():
        score += 50
    elif all(tok in title for tok in query_tokens):
        score += 30
    else:
        matched = sum(1 for tok in query_tokens if tok in title)
        if query_tokens:
            score += 20 * (matched / len(query_tokens))

    # --- popularity (log-scaled to cap outsized influence) ---
    import math
    if popularity > 0:
        score += min(15, math.log1p(popularity) * 1.5)

    # --- recency / upcoming ---
    if release_str:
        try:
            rel_date = date.fromisoformat(release_str[:10])
            delta_days = (date.today() - rel_date).days
            if -180 <= delta_days <= 180:   # within 6 months either side
                score += 10
        except ValueError:
            pass

    # --- quality signal ---
    score += min(5, vote_avg * 0.5)

    return score


def rank_results(results: list[dict], query: str) -> list[dict]:
    """Sort a flat TMDB results list by _relevance_score, descending."""
    tokens = _slugify(query).split()
    return sorted(results, key=lambda item: _relevance_score(item, tokens), reverse=True)



class ShowSearchView(APIView):
    """GET /api/search/shows/?query=<text>&page=<int>"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("query", "").strip()
        if not query:
            return Response(
                {"detail": "query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1

        try:
            results = TMDBService().search_shows(query, page=page)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(results, status=status.HTTP_200_OK)


class UniversalSearchView(APIView):
    """
    GET /api/search/universal/?query=<text>&page=<int>

    Hits TMDB /search/multi, re-ranks results using a hybrid relevancy
    engine (title match + popularity + recency), and returns a unified
    list of both movies and TV shows. Person results are filtered out.
    Response shape mirrors the discover feed items so the frontend can
    reuse the same card component.

    Fallback: if the first-pass query returns < 3 results, a second
    attempt with punctuation-stripped tokens is made automatically.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        query = request.query_params.get("query", "").strip()
        if not query:
            return Response(
                {"detail": "query parameter is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1

        try:
            data = TMDBService().search_multi(query, page=page)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        results = data.get("results", [])

        # Fallback: strip punctuation and retry if weak results
        if len(results) < 3:
            stripped_query = re.sub(r"[^\w\s]", " ", query).strip()
            if stripped_query != query:
                try:
                    fallback = TMDBService().search_multi(stripped_query, page=page)
                    fallback_results = fallback.get("results", [])
                    # Merge, deduplicate by (media_type, tmdb_id)
                    seen = {(r["media_type"], r["tmdb_id"]) for r in results}
                    for r in fallback_results:
                        key = (r.get("media_type"), r.get("tmdb_id"))
                        if key not in seen:
                            results.append(r)
                            seen.add(key)
                except TMDBServiceError:
                    pass

        ranked = rank_results(results, query)

        return Response(
            {
                "page": data.get("page", page),
                "total_pages": data.get("total_pages", 1),
                "total_results": len(ranked),
                "results": ranked,
            },
            status=status.HTTP_200_OK,
        )


class ShowDetailView(APIView):
    """GET /api/shows/<tmdb_id>/"""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        try:
            show = TMDBService().get_show_details(tmdb_id)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        serializer = CachedShowSerializer(show, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class SeasonEpisodesView(APIView):
    """GET /api/shows/<tmdb_id>/season/<season_number>/"""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int, season_number: int):
        try:
            episodes = TMDBService().get_season_episodes(tmdb_id, season_number)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        serializer = CachedEpisodeSerializer(episodes, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class EpisodeDetailView(APIView):
    """
    GET /api/episodes/<episode_id>/

    Full payload for the Episode Details screen: standard episode
    fields (via CachedEpisodeSerializer) plus an embedded lightweight
    show summary, a `credits` block (cast, guest_stars, directors,
    writers) via get_episode_full_credits, and the requesting user's
    own `interaction` (emotion_emoji, mvp_character_id,
    mvp_character_name), or null if they haven't reacted yet. If TMDB
    is unreachable for credits, the episode metadata is still returned
    with an empty credits block rather than failing the whole screen.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, episode_id: int):
        episode = CachedEpisode.objects.filter(pk=episode_id).select_related("show").first()
        if episode is None:
            return Response(
                {"detail": f"Episode {episode_id} is not cached yet."},
                status=status.HTTP_404_NOT_FOUND,
            )

        data = CachedEpisodeSerializer(episode, context={"request": request}).data
        data["show"] = {
            "tmdb_id": episode.show.tmdb_id,
            "title": episode.show.title,
            "poster_path": episode.show.poster_path,
            "backdrop_path": episode.show.backdrop_path,
        }

        try:
            data["credits"] = TMDBService().get_episode_full_credits(
                episode.show_id, episode.season_number, episode.episode_number
            )
        except TMDBServiceError:
            data["credits"] = {"cast": [], "guest_stars": [], "directors": [], "writers": []}

        interaction = EpisodeInteraction.objects.filter(user=request.user, episode=episode).first()
        data["interaction"] = (
            {
                "emotion_emoji": interaction.emotion_emoji,
                "mvp_character_id": interaction.mvp_character_id,
                "mvp_character_name": interaction.mvp_character_name,
            }
            if interaction is not None
            else None
        )

        return Response(data, status=status.HTTP_200_OK)


class EpisodeCreditsView(APIView):
    """GET /api/episodes/<episode_id>/credits/ — flat cast list, used by MVPVotingSheet."""

    permission_classes = [IsAuthenticated]

    def get(self, request, episode_id: int):
        episode = CachedEpisode.objects.filter(pk=episode_id).select_related("show").first()
        if episode is None:
            return Response(
                {"detail": f"Episode {episode_id} is not cached yet."},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            credits = TMDBService().get_episode_credits(
                episode.show_id, episode.season_number, episode.episode_number
            )
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(credits, status=status.HTTP_200_OK)


class ShowCreditsView(APIView):
    """GET /api/shows/<tmdb_id>/credits/ — show-level cast & crew, aggregated across all episodes."""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        try:
            credits = TMDBService().get_show_credits(tmdb_id)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(credits, status=status.HTTP_200_OK)


class ShowRecommendationsView(APIView):
    """GET /api/shows/<tmdb_id>/recommendations/?page=<int>"""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1

        try:
            recommendations = TMDBService().get_recommendations(tmdb_id, page=page)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(recommendations, status=status.HTTP_200_OK)


class WatchProvidersView(APIView):
    """GET /api/shows/<tmdb_id>/watch-providers/?region=<ISO-3166-1, default US>"""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        region = request.query_params.get("region", "US").upper()
        try:
            providers = TMDBService().get_watch_providers(tmdb_id, region=region)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(providers, status=status.HTTP_200_OK)


# ---------------------------------------------------------------------------
# Movie Endpoints  (full TMDB detail suite)
# ---------------------------------------------------------------------------

class MovieDetailView(APIView):
    """
    GET /api/movies/<tmdb_id>/

    Returns full TMDB movie details including genres, runtime, tagline,
    production companies, and embedded credits/providers fetched via
    append_to_response (all cached by TMDBService.get_movie_details).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        try:
            movie = TMDBService().get_movie_details(tmdb_id)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(
            {
                "tmdb_id": movie.tmdb_id,
                "title": movie.title,
                "overview": movie.overview,
                "poster_path": movie.poster_path,
                "backdrop_path": movie.backdrop_path,
                "release_date": str(movie.release_date) if movie.release_date else None,
                "runtime_minutes": movie.runtime_minutes,
                "genres": [g.strip() for g in movie.genres_string.split(",") if g.strip()],
                "vote_average": movie.vote_average,
            },
            status=status.HTTP_200_OK,
        )


class MovieCreditsView(APIView):
    """GET /api/movies/<tmdb_id>/credits/ — cast & crew from cached credits block."""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        try:
            credits = TMDBService().get_movie_credits(tmdb_id)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(credits, status=status.HTTP_200_OK)


class MovieWatchProvidersView(APIView):
    """GET /api/movies/<tmdb_id>/watch-providers/?region=US"""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        region = request.query_params.get("region", "US").upper()
        try:
            providers = TMDBService().get_movie_watch_providers(tmdb_id, region=region)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(providers, status=status.HTTP_200_OK)


class MovieRecommendationsView(APIView):
    """GET /api/movies/<tmdb_id>/recommendations/?page=<int>"""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id: int):
        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1
        try:
            recs = TMDBService().get_movie_recommendations(tmdb_id, page=page)
        except TMDBNotFoundError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)
        except TMDBRateLimitError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        except TMDBServiceError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)

        return Response(recs, status=status.HTTP_200_OK)