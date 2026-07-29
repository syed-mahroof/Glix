"""
backend/core/profile_views.py

GET returns the authenticated user's profile with computed watch-time
breakdowns; PATCH allows updating the mutable subset of fields
(currently just the avatar URL).
"""

from django.core.cache import cache
from django.db import transaction
from django.db.models import Sum
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.cache_keys import movie_watchlist_cache_key, watchlist_cache_key
from core.models import MovieWatchlist, MovieWatchState, UserProfile, Watchlist, WatchState
from core.serializers import UserProfileSerializer
from core.services import TMDBService


class ProfileView(APIView):
    """
    GET   /api/profile/
    PATCH /api/profile/
    Body (PATCH): {"profile_picture": "https://..."}
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        serializer = UserProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)


class ProfileStatsResyncView(APIView):
    """
    POST /api/profile/resync-stats/

    total_time_watched is an incrementally-maintained counter (F()
    expression, bumped on every toggle/import chunk) — correct in the
    common case, but with no way to verify or correct it if it ever drifts
    from ground truth (an episode's runtime_minutes was 0 at cache time and
    only backfilled later, a partial failure, etc.). This recomputes it
    from source-of-truth rows via aggregate SUM, not a Python loop, so it
    stays cheap even for a 300+ show library, and overwrites the stored
    counter with the true value. Shows/movies counts are always correct by
    construction (a plain row count), but are returned too so the client
    can refresh all four stat tiles from one verified response.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        with transaction.atomic():
            profile = UserProfile.objects.select_for_update().get(user=user)

            tv_minutes = WatchState.objects.filter(user=user).aggregate(
                total=Sum("episode__runtime_minutes")
            )["total"] or 0
            movie_minutes = MovieWatchState.objects.filter(user=user).aggregate(
                total=Sum("movie__runtime_minutes")
            )["total"] or 0
            true_total = tv_minutes + movie_minutes

            profile.total_time_watched = true_total
            profile.save(update_fields=["total_time_watched", "updated_at"])

        # Best-effort — a resync is explicitly a "make sure I'm looking at
        # the truth right now" action, so serve the next Shows/Movies Hub
        # fetch fresh too rather than whatever's left of the short TTL.
        cache.delete(watchlist_cache_key(user.id))
        cache.delete(movie_watchlist_cache_key(user.id))

        return Response(
            {
                "total_time_watched": true_total,
                "shows_count": Watchlist.objects.filter(user=user).count(),
                "movies_count": MovieWatchlist.objects.filter(user=user).count(),
            },
            status=status.HTTP_200_OK,
        )


class AvatarOptionsView(APIView):
    """
    GET /api/profile/avatar-options/

    Feeds the Profile avatar picker ("EDIT" on the Profile hub). Returns a
    "cast" pool of real TMDB character headshots — top-billed cast pulled
    from currently trending TV shows and popular movies, keeping each
    entry's in-show `character` name rather than the actor's real name (see
    `TMDBService.get_popular_characters()` for why: TMDB has no dedicated
    character-portrait asset, so the underlying photo is still the actor's
    headshot, but the picker is now sourced/labeled as "characters from
    shows" instead of "random popular people"). The picker's other pool,
    illustrated/cartoon-style avatars, is generated client-side from a fixed
    seed list — no TMDB data applies there, and hard-coding TMDB image paths
    client-side is the anti-pattern GenreGrid.tsx's "stale hand-typed path"
    bug already taught this repo to avoid, see AUDIT.md).

    Cached 24h server-side: this is decorative profile-picker content, not
    live data, and without caching every Profile > Edit tap would cost
    ~16 TMDB credits calls (8 shows + 8 movies).
    """

    permission_classes = [IsAuthenticated]
    CACHE_TTL_SECONDS = 60 * 60 * 24
    CACHE_KEY = "profile_avatar_character_options"

    def get(self, request):
        cached = cache.get(self.CACHE_KEY)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

        tmdb = TMDBService()
        data = tmdb.get_popular_characters(limit=40)

        payload = {"cast": data.get("results", [])}
        cache.set(self.CACHE_KEY, payload, timeout=self.CACHE_TTL_SECONDS)
        return Response(payload, status=status.HTTP_200_OK)