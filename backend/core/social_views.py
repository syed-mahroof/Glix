"""
backend/core/social_views.py

Follow graph, user search, public profiles, and the friends activity feed
(Phase 74). Not to be confused with core/social_auth.py, which is OAuth
identity linking (Google/Apple "sub" claim verification) — a completely
different concept that happens to share the word "social".

Privacy contract: a private account (UserProfile.is_private) is 404 on
every endpoint here — search excludes them, follow/profile/followers/
following all 404 — deliberately indistinguishable from "user does not
exist" so a private account can't be enumerated by response shape.
"""

from collections import defaultdict
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.db.models import Case, Count, Exists, IntegerField, OuterRef, Q, Value, When
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.analytics_views import _get_profile, _get_streak
from core.cache_keys import (
    FRIENDS_FEED_CACHE_TTL_SECONDS,
    PUBLIC_PROFILE_CACHE_TTL_SECONDS,
    friends_feed_cache_key,
    public_profile_cache_key,
)
from core.models import Follow, MovieWatchState, Watchlist, WatchState
from core.pagination import StandardResultsPagination
from core.social_serializers import FollowEdgeSerializer, PublicUserSerializer

User = get_user_model()

# Read-time fan-in budget for FriendsActivityView — see its docstring.
MAX_FOLLOWEES = 200
RAW_ROW_CAP = 400
ACTIVITY_WINDOW_DAYS = 14


def _visible_or_404(username: str, viewer):
    """Resolve a username to a User, 404ing for both "doesn't exist" and
    "is private" (unless the viewer is looking at themselves)."""
    target = get_object_or_404(
        User.objects.select_related("profile"), username__iexact=username
    )
    is_self = target.id == viewer.id
    if not is_self and getattr(target.profile, "is_private", False):
        raise Http404
    return target, is_self


class UserSearchView(APIView):
    """GET /users/search/?q=<query> — username search, private accounts excluded."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if len(q) < 2:
            return Response(
                {"detail": "q must be at least 2 characters."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        viewer = request.user
        queryset = (
            User.objects.filter(username__icontains=q)
            .filter(Q(profile__isnull=True) | Q(profile__is_private=False))
            .exclude(id=viewer.id)
            .select_related("profile")
            .annotate(
                is_following=Exists(
                    Follow.objects.filter(follower=viewer, following=OuterRef("pk"))
                ),
                _rank=Case(
                    When(username__istartswith=q, then=Value(0)),
                    default=Value(1),
                    output_field=IntegerField(),
                ),
            )
            .order_by("_rank", "username")
        )

        paginator = StandardResultsPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = PublicUserSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class FollowToggleView(APIView):
    """
    POST /users/<str:username>/follow/ — presence-based toggle, mirrors
    CommentLikeToggleView (comment_views.py:147-175) including the
    IntegrityError-inside-atomic() double-tap guard.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, username):
        target = get_object_or_404(
            User.objects.select_related("profile"), username__iexact=username
        )
        is_self = target.id == request.user.id
        if not is_self and getattr(target.profile, "is_private", False):
            raise Http404
        if is_self:
            return Response(
                {"detail": "You can't follow yourself."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        existing = Follow.objects.filter(follower=request.user, following=target).first()

        if existing is not None:
            existing.delete()
            following = False
        else:
            try:
                with transaction.atomic():
                    Follow.objects.create(follower=request.user, following=target)
                following = True
            except IntegrityError:
                # Race: another request from the same user landed first.
                following = True

        cache.delete(public_profile_cache_key(target.id))
        cache.delete(public_profile_cache_key(request.user.id))

        return Response(
            {
                "username": target.username,
                "following": following,
                "follower_count": target.incoming_follows.count(),
            },
            status=status.HTTP_200_OK,
        )


def _paginate_edges(request, view, queryset, edge_side: str):
    paginator = StandardResultsPagination()
    page = paginator.paginate_queryset(queryset, request, view=view)

    user_ids = [
        (edge.follower_id if edge_side == "follower" else edge.following_id) for edge in page
    ]
    is_following_ids = set(
        Follow.objects.filter(follower=request.user, following_id__in=user_ids).values_list(
            "following_id", flat=True
        )
    )

    serializer = FollowEdgeSerializer(
        page,
        many=True,
        context={"edge_side": edge_side, "is_following_ids": is_following_ids},
    )
    return paginator.get_paginated_response(serializer.data)


class FollowerListView(APIView):
    """GET /users/<str:username>/followers/"""

    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        target, _ = _visible_or_404(username, request.user)
        queryset = (
            Follow.objects.filter(following=target)
            .select_related("follower", "follower__profile")
            .order_by("-created_at")
        )
        return _paginate_edges(request, self, queryset, edge_side="follower")


class FollowingListView(APIView):
    """GET /users/<str:username>/following/"""

    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        target, _ = _visible_or_404(username, request.user)
        queryset = (
            Follow.objects.filter(follower=target)
            .select_related("following", "following__profile")
            .order_by("-created_at")
        )
        return _paginate_edges(request, self, queryset, edge_side="following")


def _build_public_profile_blob(user) -> dict:
    """Target-owned fields only — nothing here depends on who's asking,
    which is what makes this cacheable. ~9 queries."""

    profile = _get_profile(user)
    streak = _get_streak(user)

    shows_tracked = Watchlist.objects.filter(user=user).count()
    movies_watched = MovieWatchState.objects.filter(user=user).count()
    episodes_watched = WatchState.objects.filter(user=user).count()

    top_shows = [
        {
            "tmdb_id": row["episode__show_id"],
            "title": row["episode__show__title"],
            "poster_path": row["episode__show__poster_path"],
            "episodes_watched": row["episodes_watched"],
        }
        for row in (
            WatchState.objects.filter(user=user)
            .values("episode__show_id", "episode__show__title", "episode__show__poster_path")
            .annotate(episodes_watched=Count("id"))
            .order_by("-episodes_watched")[:5]
        )
    ]

    recent_movies = [
        {
            "tmdb_id": mw.movie_id,
            "title": mw.movie.title,
            "poster_path": mw.movie.poster_path,
            "watched_at": mw.watched_at,
        }
        for mw in (
            MovieWatchState.objects.filter(user=user)
            .select_related("movie")
            .order_by("-watched_at")[:5]
        )
    ]

    public_lists = [
        {"id": lst.id, "name": lst.name, "item_count": lst.item_count}
        for lst in (
            user.custom_lists.filter(is_private=False)
            .annotate(item_count=Count("items"))
            .order_by("-updated_at")[:10]
        )
    ]

    return {
        "username": user.username,
        "profile_picture": profile.profile_picture,
        "member_since": user.date_joined,
        "total_time_watched": profile.total_time_watched,
        "watched_hours": round(profile.total_time_watched / 60, 1),
        "earned_badges": profile.earned_badges,
        "current_streak": streak.current_streak,
        "longest_streak": streak.longest_streak,
        "shows_tracked": shows_tracked,
        "movies_watched": movies_watched,
        "episodes_watched": episodes_watched,
        "top_shows": top_shows,
        "recent_movies": recent_movies,
        "public_lists": public_lists,
        "follower_count": user.incoming_follows.count(),
        "following_count": user.outgoing_follows.count(),
    }


class UserProfileDetailView(APIView):
    """
    GET /users/<str:username>/ — public profile.

    The target-owned blob (~9 queries) is cached 300s; viewer-relative
    fields (is_self/is_following/follows_you) are computed fresh every
    request from one combined edge query and merged in afterwards, so
    someone else's cached profile never leaks into your own is_following
    state.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, username):
        target, is_self = _visible_or_404(username, request.user)

        cache_key = public_profile_cache_key(target.id)
        blob = cache.get(cache_key)
        if blob is None:
            blob = _build_public_profile_blob(target)
            cache.set(cache_key, blob, PUBLIC_PROFILE_CACHE_TTL_SECONDS)

        data = dict(blob)
        data["is_self"] = is_self
        if is_self:
            data["is_following"] = False
            data["follows_you"] = False
        else:
            edge_set = set(
                Follow.objects.filter(
                    Q(follower=request.user, following=target)
                    | Q(follower=target, following=request.user)
                ).values_list("follower_id", "following_id")
            )
            data["is_following"] = (request.user.id, target.id) in edge_set
            data["follows_you"] = (target.id, request.user.id) in edge_set

        return Response(data, status=status.HTTP_200_OK)


class FriendsActivityView(APIView):
    """
    GET /feed/activity/ — read-time fan-in over followees' recent watch
    activity. Deliberately NOT a fan-out inbox table: the single Celery
    worker (--concurrency=1) already shares capacity with TV Time imports
    and can't absorb a write on every episode/movie watched. Two queries
    + a Python merge instead, bounded by a 14-day window (load-bearing —
    without it, ORDER BY watched_at DESC sorts over followees' entire
    history), MAX_FOLLOWEES, and RAW_ROW_CAP per source.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        cache_key = friends_feed_cache_key(user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

        followee_ids = list(
            Follow.objects.filter(follower=user)
            .order_by("-created_at")
            .values_list("following_id", flat=True)[:MAX_FOLLOWEES]
        )

        if not followee_ids:
            payload = {"count": 0, "total_pages": 0, "current_page": 1, "next": None, "previous": None, "results": []}
            cache.set(cache_key, payload, FRIENDS_FEED_CACHE_TTL_SECONDS)
            return Response(payload, status=status.HTTP_200_OK)

        since = timezone.now() - timedelta(days=ACTIVITY_WINDOW_DAYS)

        episode_rows = (
            WatchState.objects.filter(user_id__in=followee_ids, watched_at__gte=since)
            .select_related("user", "user__profile", "episode__show")
            .order_by("-watched_at")[:RAW_ROW_CAP]
        )
        movie_rows = (
            MovieWatchState.objects.filter(user_id__in=followee_ids, watched_at__gte=since)
            .select_related("user", "user__profile", "movie")
            .order_by("-watched_at")[:RAW_ROW_CAP]
        )

        # Collapse multi-episode binges into one card, grouped by
        # (user, show, local calendar day) — a 12-episode binge is noise
        # as 12 separate cards.
        binge_groups: dict = {}
        for row in episode_rows:
            day = timezone.localtime(row.watched_at).date()
            key = (row.user_id, row.episode.show_id, day)
            group = binge_groups.get(key)
            if group is None:
                binge_groups[key] = {
                    "type": "episodes",
                    "user_id": row.user_id,
                    "username": row.user.username,
                    "profile_picture": getattr(row.user.profile, "profile_picture", None),
                    "show_id": row.episode.show_id,
                    "show_title": row.episode.show.title,
                    "poster_path": row.episode.show.poster_path,
                    "episode_count": 1,
                    "watched_at": row.watched_at,
                }
            else:
                group["episode_count"] += 1
                if row.watched_at > group["watched_at"]:
                    group["watched_at"] = row.watched_at

        cards = list(binge_groups.values())

        for row in movie_rows:
            cards.append(
                {
                    "type": "movie",
                    "user_id": row.user_id,
                    "username": row.user.username,
                    "profile_picture": getattr(row.user.profile, "profile_picture", None),
                    "movie_id": row.movie_id,
                    "movie_title": row.movie.title,
                    "poster_path": row.movie.poster_path,
                    "watched_at": row.watched_at,
                }
            )

        cards.sort(key=lambda c: c["watched_at"], reverse=True)

        paginator = StandardResultsPagination()
        page = paginator.paginate_queryset(cards, request, view=self)
        response = paginator.get_paginated_response(page)

        cache.set(cache_key, response.data, FRIENDS_FEED_CACHE_TTL_SECONDS)
        return response
