"""
backend/core/lists_views.py

User-created lists ("Movies2026", etc.) — distinct from Watchlist/
MovieWatchlist, the built-in "want to watch" trackers. Split out of
core/views.py following the same precedent as analytics_views.py/
profile_views.py/search_views.py, rather than growing that already
1300+-line file further.
"""

from collections import defaultdict

from django.db.models import Count
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import CachedShow, CustomList, CustomListItem, MovieCache
from core.serializers import CustomListItemSerializer, CustomListSerializer


def _build_cover_map(items):
    """
    One query per media type (not per item) to resolve title/poster_path
    for a batch of (media_type, tmdb_id) pairs — see CachedShow/MovieCache,
    both already kept fresh by TMDBService regardless of this feature.
    """
    tv_ids = {i.tmdb_id for i in items if i.media_type == CustomListItem.MediaType.TV}
    movie_ids = {i.tmdb_id for i in items if i.media_type == CustomListItem.MediaType.MOVIE}

    cover_map = {}
    if tv_ids:
        for show in CachedShow.objects.filter(tmdb_id__in=tv_ids):
            cover_map[(CustomListItem.MediaType.TV, show.tmdb_id)] = {
                "title": show.title,
                "poster_path": show.poster_path,
            }
    if movie_ids:
        for movie in MovieCache.objects.filter(tmdb_id__in=movie_ids):
            cover_map[(CustomListItem.MediaType.MOVIE, movie.tmdb_id)] = {
                "title": movie.title,
                "poster_path": movie.poster_path,
            }
    return cover_map


class CustomListsView(APIView):
    """
    GET  /api/lists/          — the user's lists, with item_count + up to
                                 4 cover posters each (for a collage).
    POST /api/lists/          — quick-create. Body: {"name": "...",
                                 "description"?: "...", "is_private"?: bool}
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        lists = list(CustomList.objects.filter(user=request.user))
        list_ids = [l.id for l in lists]

        item_counts = {
            row["list"]: row["c"]
            for row in CustomListItem.objects.filter(list_id__in=list_ids)
            .values("list")
            .annotate(c=Count("id"))
        }
        # Only need a few items per list for the cover collage, not all of
        # them — capped client-side of the DB (per-list slice) since a
        # single query can't LIMIT per group without a window function.
        items_by_list: dict = defaultdict(list)
        for item in CustomListItem.objects.filter(list_id__in=list_ids).order_by("-added_at"):
            if len(items_by_list[item.list_id]) < 4:
                items_by_list[item.list_id].append(item)

        all_preview_items = [i for items in items_by_list.values() for i in items]
        cover_map = _build_cover_map(all_preview_items)

        serializer = CustomListSerializer(
            lists,
            many=True,
            context={
                "item_counts": item_counts,
                "items_by_list": items_by_list,
                "cover_map": cover_map,
            },
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    def post(self, request):
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "name is required."}, status=status.HTTP_400_BAD_REQUEST)

        custom_list = CustomList.objects.create(
            user=request.user,
            name=name[:100],
            description=(request.data.get("description") or "").strip()[:280],
            is_private=request.data.get("is_private", True),
        )
        serializer = CustomListSerializer(
            custom_list,
            context={"item_counts": {}, "items_by_list": {}, "cover_map": {}},
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CustomListDetailView(APIView):
    """
    GET    /api/lists/<id>/   — list metadata + full items.
    PATCH  /api/lists/<id>/   — rename / edit description / toggle privacy.
    DELETE /api/lists/<id>/   — delete the list and its items (CASCADE).
    """

    permission_classes = [IsAuthenticated]

    def _get_list(self, request, list_id):
        # Ad hoc inline ownership check — the convention every other
        # per-object endpoint in this codebase already uses (see
        # MovieRemoveView/ShowRemoveView), not the unused IsOwner class.
        return get_object_or_404(CustomList, pk=list_id, user=request.user)

    def get(self, request, list_id):
        custom_list = self._get_list(request, list_id)
        items = list(custom_list.items.all())
        cover_map = _build_cover_map(items)

        list_data = CustomListSerializer(
            custom_list,
            context={"item_counts": {custom_list.id: len(items)}, "items_by_list": {}, "cover_map": {}},
        ).data
        list_data["items"] = CustomListItemSerializer(
            items, many=True, context={"cover_map": cover_map}
        ).data
        return Response(list_data, status=status.HTTP_200_OK)

    def patch(self, request, list_id):
        custom_list = self._get_list(request, list_id)
        if "name" in request.data:
            name = (request.data.get("name") or "").strip()
            if not name:
                return Response({"detail": "name cannot be blank."}, status=status.HTTP_400_BAD_REQUEST)
            custom_list.name = name[:100]
        if "description" in request.data:
            custom_list.description = (request.data.get("description") or "").strip()[:280]
        if "is_private" in request.data:
            custom_list.is_private = bool(request.data.get("is_private"))
        custom_list.save()

        serializer = CustomListSerializer(
            custom_list,
            context={"item_counts": {}, "items_by_list": {}, "cover_map": {}},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    def delete(self, request, list_id):
        custom_list = self._get_list(request, list_id)
        custom_list.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class CustomListItemToggleView(APIView):
    """
    POST /api/lists/items/toggle/
    Body: {"list_id": <int>, "media_type": "movie"|"tv", "tmdb_id": <int>}

    Presence-based, same pattern as WatchStateToggleView: item exists in
    the list -> remove it; absent -> add it. Returns {"added": bool}.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        list_id = request.data.get("list_id")
        media_type = request.data.get("media_type")
        tmdb_id = request.data.get("tmdb_id")

        if not list_id or media_type not in CustomListItem.MediaType.values or not tmdb_id:
            return Response(
                {"detail": "list_id, media_type ('movie'|'tv'), and tmdb_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        custom_list = get_object_or_404(CustomList, pk=list_id, user=request.user)
        existing = CustomListItem.objects.filter(
            list=custom_list, media_type=media_type, tmdb_id=tmdb_id
        ).first()

        if existing is not None:
            existing.delete()
            added = False
        else:
            CustomListItem.objects.create(list=custom_list, media_type=media_type, tmdb_id=tmdb_id)
            added = True

        custom_list.save(update_fields=["updated_at"])
        return Response({"added": added}, status=status.HTTP_200_OK)


class CustomListMembershipView(APIView):
    """
    GET /api/lists/membership/?media_type=movie&tmdb_id=123

    Which of the user's lists already contain this item — powers the "Add
    to List" sheet's checkmarks.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        media_type = request.query_params.get("media_type")
        tmdb_id = request.query_params.get("tmdb_id")

        if media_type not in CustomListItem.MediaType.values or not tmdb_id:
            return Response(
                {"detail": "media_type ('movie'|'tv') and tmdb_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        list_ids = list(
            CustomListItem.objects.filter(
                media_type=media_type, tmdb_id=tmdb_id, list__user=request.user
            ).values_list("list_id", flat=True)
        )
        return Response({"list_ids": list_ids}, status=status.HTTP_200_OK)
