"""
backend/core/rewatch_views.py

Rewatch tracking (Phase 75.7) — a second (third, ...) time through a show
or movie. Deliberately a parallel system from WatchState/MovieWatchState
rather than an extension of them: see ShowRewatch's model docstring
(core/models.py) for why relaxing WatchState's UNIQUE(user, episode) would
be unsafe — that constraint backs the "already watched" check at several
other call sites (badges, analytics counts, history, the catch-up check),
all of which must stay blind to a rewatch.

A round only starts once every aired episode is already in WatchState —
this is a *re*watch, not a way to route around the normal watched-episode
gate. Round completion mirrors that same "every aired episode ticked" rule
against RewatchEpisodeState instead.
"""

from django.db import transaction
from django.db.models import F, Max
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.dates import has_released
from core.models import (
    CachedEpisode,
    CachedShow,
    MovieCache,
    MovieRewatch,
    MovieWatchState,
    RewatchEpisodeState,
    ShowRewatch,
    UserProfile,
    WatchState,
)


def _aired_episode_ids(show: CachedShow) -> set:
    today = timezone.now().date()
    return set(
        CachedEpisode.objects.filter(show=show, air_date__lte=today).values_list("tmdb_id", flat=True)
    )


def _clamp_profile_counters(profile: UserProfile) -> None:
    """Same defensive floor WatchStateToggleView applies to
    total_time_watched — a rapid double-tap racing two opposite toggles
    could otherwise walk a counter negative."""
    updates = {}
    if profile.total_time_watched < 0:
        updates["total_time_watched"] = 0
    if profile.total_rewatch_time_watched < 0:
        updates["total_rewatch_time_watched"] = 0
    if updates:
        UserProfile.objects.filter(pk=profile.pk).update(**updates)
        profile.refresh_from_db(fields=list(updates.keys()))


class ShowRewatchDetailView(APIView):
    """
    GET    /api/rewatch/shows/<tmdb_id>/ — the active round (if any) and
           its watched episode ids.
    DELETE /api/rewatch/shows/<tmdb_id>/ — abandons the active round,
           reverting both time-watched counters by whatever it had ticked.

    One class for both verbs on one resource — same convention
    ShowReviewView (core/review_views.py) already uses for get/post/delete.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id):
        show = get_object_or_404(CachedShow, pk=tmdb_id)
        # The latest round regardless of completed_at — a finished round
        # (every aired episode ticked) is still the one the toggle endpoint
        # edits until a new round is explicitly started, so the client
        # needs to see it (and its `completed` flag) rather than have it
        # vanish from view the instant the last episode is ticked.
        latest = ShowRewatch.objects.filter(user=request.user, show=show).order_by("-round_number").first()
        if latest is None:
            return Response({"active_rewatch": None}, status=status.HTTP_200_OK)

        watched_episode_ids = list(
            RewatchEpisodeState.objects.filter(rewatch=latest).values_list("episode_id", flat=True)
        )
        return Response(
            {
                "active_rewatch": {
                    "round_number": latest.round_number,
                    "watched_episode_ids": watched_episode_ids,
                    "aired_episode_count": len(_aired_episode_ids(show)),
                    "completed": latest.completed_at is not None,
                }
            },
            status=status.HTTP_200_OK,
        )

    def delete(self, request, tmdb_id):
        show = get_object_or_404(CachedShow, pk=tmdb_id)
        active = ShowRewatch.objects.filter(
            user=request.user, show=show, completed_at__isnull=True
        ).first()
        if active is None:
            return Response({"detail": "No active rewatch round."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(user=request.user)
            ticked = RewatchEpisodeState.objects.filter(rewatch=active).select_related("episode")
            runtime_delta = sum(state.episode.runtime_minutes for state in ticked)
            if runtime_delta:
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") - runtime_delta,
                    total_rewatch_time_watched=F("total_rewatch_time_watched") - runtime_delta,
                )
                profile.refresh_from_db(fields=["total_time_watched", "total_rewatch_time_watched"])
                _clamp_profile_counters(profile)
            active.delete()  # cascades RewatchEpisodeState rows

        return Response(status=status.HTTP_204_NO_CONTENT)


class ShowRewatchStartView(APIView):
    """
    POST /api/rewatch/shows/<tmdb_id>/start/ — begins a new round.

    400 unless every aired episode is already in WatchState (a rewatch
    presupposes a completed first watch-through) and no round is already
    active for this show.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, tmdb_id):
        show = get_object_or_404(CachedShow, pk=tmdb_id)

        if ShowRewatch.objects.filter(user=request.user, show=show, completed_at__isnull=True).exists():
            return Response(
                {"detail": "A rewatch round is already in progress for this show."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        aired_ids = _aired_episode_ids(show)
        if not aired_ids:
            return Response(
                {"detail": "This show has no aired episodes to rewatch yet."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        watched_ids = set(
            WatchState.objects.filter(
                user=request.user, episode_id__in=aired_ids
            ).values_list("episode_id", flat=True)
        )
        if watched_ids != aired_ids:
            return Response(
                {"detail": "Watch every aired episode before starting a rewatch."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        last_round = (
            ShowRewatch.objects.filter(user=request.user, show=show).aggregate(latest=Max("round_number"))[
                "latest"
            ]
            or 1
        )
        rewatch = ShowRewatch.objects.create(user=request.user, show=show, round_number=last_round + 1)
        return Response(
            {"round_number": rewatch.round_number, "watched_episode_ids": []},
            status=status.HTTP_201_CREATED,
        )


class RewatchEpisodeToggleView(APIView):
    """
    POST /api/rewatch/episodes/<episode_tmdb_id>/toggle/ — presence toggle
    within the active round for that episode's show. Mirrors
    WatchStateToggleView's F()-expression pattern, applied to both
    total_time_watched and total_rewatch_time_watched, and stamps the
    round's completed_at once every aired episode has been ticked.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, episode_tmdb_id):
        episode = get_object_or_404(CachedEpisode, pk=episode_tmdb_id)
        # The latest round for this show, complete or not — NOT filtered to
        # completed_at__isnull=True. A round that just got its last aired
        # episode ticked (round_completed becomes True) must stay editable
        # so a mis-tap can still be corrected; otherwise finishing a round
        # would immediately 400 on the very next toggle for it. Starting a
        # genuinely new round (ShowRewatchStartView) is what actually keys
        # off completed_at, not this lookup.
        active = (
            ShowRewatch.objects.filter(user=request.user, show=episode.show)
            .order_by("-round_number")
            .first()
        )
        if active is None:
            return Response(
                {"detail": "No active rewatch round for this show."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(user=request.user)
            existing = RewatchEpisodeState.objects.filter(rewatch=active, episode=episode).first()

            if existing is not None:
                existing.delete()
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") - episode.runtime_minutes,
                    total_rewatch_time_watched=F("total_rewatch_time_watched") - episode.runtime_minutes,
                )
                if active.completed_at is not None:
                    active.completed_at = None
                    active.save(update_fields=["completed_at"])
                watched = False
            else:
                if not has_released(episode.air_date):
                    return Response(
                        {"detail": "This episode hasn't aired yet — you can't mark it watched."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                RewatchEpisodeState.objects.create(rewatch=active, episode=episode)
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") + episode.runtime_minutes,
                    total_rewatch_time_watched=F("total_rewatch_time_watched") + episode.runtime_minutes,
                )
                watched = True

                aired_ids = _aired_episode_ids(episode.show)
                ticked_ids = set(
                    RewatchEpisodeState.objects.filter(rewatch=active).values_list("episode_id", flat=True)
                )
                if aired_ids and aired_ids.issubset(ticked_ids):
                    active.completed_at = timezone.now()
                    active.save(update_fields=["completed_at"])

            profile.refresh_from_db(fields=["total_time_watched", "total_rewatch_time_watched"])
            _clamp_profile_counters(profile)

        return Response(
            {
                "episode_id": episode.tmdb_id,
                "watched": watched,
                "round_completed": active.completed_at is not None,
                "total_time_watched": profile.total_time_watched,
            },
            status=status.HTTP_200_OK,
        )


class MovieRewatchCreateView(APIView):
    """
    POST   /api/rewatch/movies/<tmdb_id>/ — +1 rewatch row.
    DELETE /api/rewatch/movies/<tmdb_id>/ — removes the most recent one
    (undoes an accidental tap; never touches MovieWatchState).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, tmdb_id):
        movie = get_object_or_404(MovieCache, pk=tmdb_id)
        if not MovieWatchState.objects.filter(user=request.user, movie=movie).exists():
            return Response(
                {"detail": "Mark this movie as watched before rewatching it."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(user=request.user)
            MovieRewatch.objects.create(user=request.user, movie=movie)
            UserProfile.objects.filter(pk=profile.pk).update(
                total_time_watched=F("total_time_watched") + movie.runtime_minutes,
                total_rewatch_time_watched=F("total_rewatch_time_watched") + movie.runtime_minutes,
            )
            profile.refresh_from_db(fields=["total_time_watched", "total_rewatch_time_watched"])

        rewatch_count = MovieRewatch.objects.filter(user=request.user, movie=movie).count()
        return Response(
            {"rewatch_count": rewatch_count, "total_time_watched": profile.total_time_watched},
            status=status.HTTP_201_CREATED,
        )

    def delete(self, request, tmdb_id):
        movie = get_object_or_404(MovieCache, pk=tmdb_id)
        most_recent = (
            MovieRewatch.objects.filter(user=request.user, movie=movie).order_by("-watched_at").first()
        )
        if most_recent is None:
            return Response({"detail": "No rewatch to remove."}, status=status.HTTP_404_NOT_FOUND)

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(user=request.user)
            most_recent.delete()
            UserProfile.objects.filter(pk=profile.pk).update(
                total_time_watched=F("total_time_watched") - movie.runtime_minutes,
                total_rewatch_time_watched=F("total_rewatch_time_watched") - movie.runtime_minutes,
            )
            profile.refresh_from_db(fields=["total_time_watched", "total_rewatch_time_watched"])
            _clamp_profile_counters(profile)

        rewatch_count = MovieRewatch.objects.filter(user=request.user, movie=movie).count()
        return Response({"rewatch_count": rewatch_count}, status=status.HTTP_200_OK)
