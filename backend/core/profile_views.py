"""
backend/core/profile_views.py

GET returns the authenticated user's profile with computed watch-time
breakdowns and follower/following counts; PATCH allows updating the
mutable subset of fields — the avatar URL (profile_picture) and, since
Phase 74, the username (case-insensitive uniqueness + Django's standard
username charset, enforced in UserProfileSerializer.validate_username/
update) and is_private ("ghost mode" — see UserProfile.is_private and
core/social_views.py). email stays read-only.
"""

from django.db import transaction
from django.db.models import Sum
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.cache_keys import movie_watchlist_cache_key, watchlist_cache_key
from core.cache_utils import safe_cache_delete, safe_cache_get, safe_cache_set
from core.models import MovieWatchlist, MovieWatchState, UserProfile, Watchlist, WatchState
from core.serializers import UserProfileSerializer
from core.services import TMDBService, TMDBServiceError


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
        safe_cache_delete(watchlist_cache_key(user.id))
        safe_cache_delete(movie_watchlist_cache_key(user.id))

        return Response(
            {
                "total_time_watched": true_total,
                "shows_count": Watchlist.objects.filter(user=user).count(),
                "movies_count": MovieWatchlist.objects.filter(user=user).count(),
            },
            status=status.HTTP_200_OK,
        )


class AvatarOptionsView(APIView):
    """Cached cast portraits; collections share no private user data."""

    permission_classes = [IsAuthenticated]
    CACHE_TTL_SECONDS = 60 * 60 * 24
    CACHE_KEY = "profile_avatar_character_options_v2"

    def get(self, request):
        collection = request.query_params.get("collection", "trending")
        if collection not in ("trending", "classics"):
            return Response({"detail": "Choose trending or classics."}, status=status.HTTP_400_BAD_REQUEST)
        cache_key = f"{self.CACHE_KEY}:{collection}"
        cached = safe_cache_get(cache_key)
        if cached is not None:
            return Response(cached)
        try:
            data = TMDBService().get_popular_characters(limit=48, collection=collection)
        except TMDBServiceError:
            return Response({"detail": "Cast portraits are temporarily unavailable. Please retry or choose an illustrated avatar."}, status=status.HTTP_502_BAD_GATEWAY)
        payload = {"cast": data.get("results", [])}
        if payload["cast"]:
            safe_cache_set(cache_key, payload, timeout=self.CACHE_TTL_SECONDS)
        return Response(payload)
