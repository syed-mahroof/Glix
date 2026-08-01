"""
backend/core/review_serializers.py

Serializers for the show/movie review system (Phase L) — a private-by-
default personal half-star (0.5-5.0) rating + optional note, distinct
from the public Comment/CommentLike/CommentReport community system (see
ShowReview's own model docstring for why the two are kept separate).
"""

from rest_framework import serializers

from core.models import MovieReview, ShowReview


class ShowReviewSerializer(serializers.ModelSerializer):
    show_id = serializers.IntegerField(read_only=True)
    show_title = serializers.CharField(source="show.title", read_only=True)
    show_poster_path = serializers.CharField(source="show.poster_path", read_only=True)
    # coerce_to_string=False: DRF's DecimalField renders Decimal("3.5") as
    # the STRING "3.5" by default. The client types `rating: number` and
    # does `value <= rating` — JS would coerce and *appear* to work, which
    # is worse than a clean break because the type would be silently a
    # lie. Per-field, not the global COERCE_DECIMAL_TO_STRING setting —
    # this is the only DecimalField in the backend.
    rating = serializers.DecimalField(max_digits=2, decimal_places=1, coerce_to_string=False)

    class Meta:
        model = ShowReview
        fields = [
            "id",
            "show_id",
            "show_title",
            "show_poster_path",
            "rating",
            "note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class MovieReviewSerializer(serializers.ModelSerializer):
    movie_id = serializers.IntegerField(read_only=True)
    movie_title = serializers.CharField(source="movie.title", read_only=True)
    movie_poster_path = serializers.CharField(source="movie.poster_path", read_only=True)
    rating = serializers.DecimalField(max_digits=2, decimal_places=1, coerce_to_string=False)

    class Meta:
        model = MovieReview
        fields = [
            "id",
            "movie_id",
            "movie_title",
            "movie_poster_path",
            "rating",
            "note",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]
