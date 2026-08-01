"""
backend/core/review_views.py

Show/movie review system (Phase L) — a private-by-default personal
half-star (0.5-5.0) rating + optional note, one per (user, show)/(user,
movie). See core.models.ShowReview's docstring for why this is kept
deliberately separate from the public Comment/CommentLike/CommentReport
system rather than a written note also becoming a Comment.

ShowReviewView/MovieReviewView are per-title CRUD (get my review for
this title / create-or-update it / delete it) — mirrors the
get_or_create-then-update-in-place convention FavoriteToggleView/
ArchiveToggleView already use elsewhere in this codebase, not a second
pattern. ShowReviewListView/MovieReviewListView are the "list" side —
every review the requesting user has ever left, most recently updated
first, consumed by app/profile/reviews.tsx ("My Reviews", Phase 74).
"""

from decimal import Decimal, InvalidOperation

from django.shortcuts import get_object_or_404
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import CachedShow, MovieCache, MovieReview, ShowReview
from core.review_serializers import MovieReviewSerializer, ShowReviewSerializer

# Half-star steps: 0.5, 1.0, 1.5, ... 5.0.
ALLOWED_RATINGS = {Decimal(str(n / 2)) for n in range(1, 11)}
RATING_ERROR = "rating must be a number between 0.5 and 5 in half-star steps."


def _parse_rating(raw):
    """Returns (Decimal, None) on success, or (None, error_message).

    Phase 74 note on the bug this replaces: the old `int(rating)` here
    did NOT raise on a JSON float like 3.5 — `int(3.5)` returns `3`
    silently. A half-star POST was accepted with 200 OK and quietly
    stored as a whole star, worse than an outright rejection. Only a
    string like "3.5" used to raise. str(raw) before Decimal() matters:
    DRF's JSONParser hands us a Python float for 3.5, and Decimal(3.5)
    (skipping the str()) is Decimal('3.5000000000000000444089209850062616169452667236328125'),
    which fails the ALLOWED_RATINGS membership check.
    """
    if raw is None:
        return None, "rating is required."
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, TypeError, ValueError):
        return None, RATING_ERROR
    if value not in ALLOWED_RATINGS:
        return None, RATING_ERROR
    return value, None


class ShowReviewView(APIView):
    """
    GET    /api/reviews/shows/<tmdb_id>/  — the requesting user's review for this show, or 404.
    POST   /api/reviews/shows/<tmdb_id>/  — create or update it. Body: {"rating": 0.5-5 in half-star steps, "note": str (optional)}
    DELETE /api/reviews/shows/<tmdb_id>/  — remove it.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, tmdb_id):
        review = get_object_or_404(ShowReview, user=request.user, show_id=tmdb_id)
        return Response(ShowReviewSerializer(review).data, status=status.HTTP_200_OK)

    def post(self, request, tmdb_id):
        rating, error = _parse_rating(request.data.get("rating"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)

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
        rating, error = _parse_rating(request.data.get("rating"))
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)

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
