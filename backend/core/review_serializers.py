"""
backend/core/review_serializers.py

Serializers for the show/movie review system (Phase L) — a private-by-
default personal 1-5 star rating + optional note, distinct from the
public Comment/CommentLike/CommentReport community system (see
ShowReview's own model docstring for why the two are kept separate).
"""

from rest_framework import serializers

from core.models import MovieReview, ShowReview


class ShowReviewSerializer(serializers.ModelSerializer):
    show_id = serializers.IntegerField(read_only=True)
    show_title = serializers.CharField(source="show.title", read_only=True)
    show_poster_path = serializers.CharField(source="show.poster_path", read_only=True)

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
