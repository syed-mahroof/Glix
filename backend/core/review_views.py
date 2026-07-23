"""
backend/core/review_views.py

Show/movie review system (Phase L) — a private-by-default personal 1-5
star rating + optional note, one per (user, show)/(user, movie). See
core.models.ShowReview's docstring for why this is kept deliberately
separate from the public Comment/CommentLike/CommentReport system rather
than a written note also becoming a Comment.

ShowReviewView/MovieReviewView are per-title CRUD (get my review for
this title / create-or-update it / delete it) — mirrors the
get_or_create-then-update-in-place convention FavoriteToggleView/
ArchiveToggleView already use elsewhere in this codebase, not a second
pattern. ShowReviewListView/MovieReviewListView are the "list" side —
every review the requesting user has ever left, most recently updated
first, for a future "My Reviews" screen.
"""

from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import CachedShow, MovieCache, MovieReview, ShowReview
from core.review_serializers import MovieReviewSerializer, ShowReviewSerializer


class ShowReviewView(APIView):
    """
    GET    /api/reviews/shows/<tmdb_id>/  — the requesting user's review for this show, or 404.
    POST   /api/reviews/shows/<tmdb_id>/  — create or update it. Body: {"rating": 1-5, "note": str (optional)}
    DELETE /api/reviews/shows/<tmdb_id>/  — remove it.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id):
        review = get_object_or_404(ShowReview, user=request.user, show_id=tmdb_id)
        return Response(ShowReviewSerializer(review).data, status=status.HTTP_200_OK)

    def post(self, request, tmdb_id):
        rating = request.data.get("rating")
        if rating is None:
            return Response({"detail": "rating is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            rating = int(rating)
        except (TypeError, ValueError):
            return Response({"detail": "rating must be an integer 1-5."}, status=status.HTTP_400_BAD_REQUEST)
        if not 1 <= rating <= 5:
            return Response({"detail": "rating must be between 1 and 5."}, status=status.HTTP_400_BAD_REQUEST)

        note = request.data.get("note", "")
        if not isinstance(note, str):
            return Response({"detail": "note must be a string."}, status=status.HTTP_400_BAD_REQUEST)

        show = get_object_or_404(CachedShow, pk=tmdb_id)
        review, created = ShowReview.objects.update_or_create(
            user=request.user, show=show, defaults={"rating": rating, "note": note}
        )
        return Response(
            ShowReviewSerializer(review).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request, tmdb_id):
        deleted, _ = ShowReview.objects.filter(user=request.user, show_id=tmdb_id).delete()
        if not deleted:
            return Response({"detail": "No review to delete."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MovieReviewView(APIView):
    """Movie counterpart to ShowReviewView — same shape, same conventions."""

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id):
        review = get_object_or_404(MovieReview, user=request.user, movie_id=tmdb_id)
        return Response(MovieReviewSerializer(review).data, status=status.HTTP_200_OK)

    def post(self, request, tmdb_id):
        rating = request.data.get("rating")
        if rating is None:
            return Response({"detail": "rating is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            rating = int(rating)
        except (TypeError, ValueError):
            return Response({"detail": "rating must be an integer 1-5."}, status=status.HTTP_400_BAD_REQUEST)
        if not 1 <= rating <= 5:
            return Response({"detail": "rating must be between 1 and 5."}, status=status.HTTP_400_BAD_REQUEST)

        note = request.data.get("note", "")
        if not isinstance(note, str):
            return Response({"detail": "note must be a string."}, status=status.HTTP_400_BAD_REQUEST)

        movie = get_object_or_404(MovieCache, pk=tmdb_id)
        review, created = MovieReview.objects.update_or_create(
            user=request.user, movie=movie, defaults={"rating": rating, "note": note}
        )
        return Response(
            MovieReviewSerializer(review).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def delete(self, request, tmdb_id):
        deleted, _ = MovieReview.objects.filter(user=request.user, movie_id=tmdb_id).delete()
        if not deleted:
            return Response({"detail": "No review to delete."}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ShowReviewListView(generics.ListAPIView):
    """GET /api/reviews/shows/ — every show review the requesting user has left."""

    permission_classes = [IsAuthenticated]
    serializer_class = ShowReviewSerializer

    def get_queryset(self):
        return ShowReview.objects.filter(user=self.request.user).select_related("show").order_by("-updated_at")


class MovieReviewListView(generics.ListAPIView):
    """GET /api/reviews/movies/ — every movie review the requesting user has left."""

    permission_classes = [IsAuthenticated]
    serializer_class = MovieReviewSerializer

    def get_queryset(self):
        return MovieReview.objects.filter(user=self.request.user).select_related("movie").order_by("-updated_at")
