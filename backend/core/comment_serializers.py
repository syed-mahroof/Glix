"""
backend/core/comment_serializers.py

Serializers for the Community & Social module. Comments and replies
share one model (core.models.Comment, self-referential via `parent`)
and one serializer here — a reply is just a Comment with `parent` set,
so a nonzero reply_count on a top-level comment is what the client
uses to decide whether to offer a "view replies" affordance.
"""

from rest_framework import serializers

from core.models import Comment, CommentReport, CommentLike


class CommentAuthorSerializer(serializers.Serializer):
    """Minimal nested author payload — avoids leaking email/full profile stats into a comment feed."""

    id = serializers.IntegerField(source="user.id")
    username = serializers.CharField(source="user.username")
    profile_picture = serializers.SerializerMethodField()

    def get_profile_picture(self, obj):
        profile = getattr(obj.user, "profile", None)
        return profile.profile_picture if profile else None


class CommentSerializer(serializers.ModelSerializer):
    """
    Handles both top-level comments and replies (parent is set).
    like_count/reply_count/is_liked_by_user are computed in the
    database by comment_views.py's CommentQuerysetMixin and read here
    via annotated attributes; the SerializerMethodFields below only
    fall back to a direct query if an object reaches this serializer
    unannotated (e.g. serializing a single freshly-created instance in
    a POST response).
    """

    user = serializers.SerializerMethodField()
    body = serializers.SerializerMethodField()
    like_count = serializers.SerializerMethodField()
    reply_count = serializers.SerializerMethodField()
    is_liked_by_user = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = [
            "id",
            "user",
            "show",
            "episode",
            "parent",
            "body",
            "is_spoiler",
            "is_edited",
            "is_deleted",
            "like_count",
            "reply_count",
            "is_liked_by_user",
            "is_owner",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "is_edited", "is_deleted", "created_at", "updated_at"]
        extra_kwargs = {
            "show": {"required": False, "allow_null": True},
            "episode": {"required": False, "allow_null": True},
            "parent": {"required": False, "allow_null": True},
        }

    def get_user(self, obj: Comment):
        return CommentAuthorSerializer(obj).data

    def get_body(self, obj: Comment) -> str:
        return "[This comment was deleted]" if obj.is_deleted else obj.body

    def get_like_count(self, obj: Comment) -> int:
        annotated = getattr(obj, "like_count_annotated", None)
        if annotated is not None:
            return annotated
        return obj.likes.count()

    def get_reply_count(self, obj: Comment) -> int:
        annotated = getattr(obj, "reply_count_annotated", None)
        if annotated is not None:
            return annotated
        return obj.replies.count()

    def get_is_liked_by_user(self, obj: Comment) -> bool:
        annotated = getattr(obj, "is_liked_annotated", None)
        if annotated is not None:
            return bool(annotated)
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        return CommentLike.objects.filter(user=request.user, comment=obj).exists()

    def get_is_owner(self, obj: Comment) -> bool:
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return False
        return request.user.id == obj.user_id

    def validate(self, attrs):
        # Only enforced for top-level comment creation; replies inherit
        # show/episode from their parent in comment_views.py's
        # perform_create, so `attrs` won't carry either key on that path.
        is_reply_creation = self.instance is None and "parent" not in attrs and attrs.get("show") is None and attrs.get("episode") is None and self.context.get("is_reply", False)
        if self.instance is None and not self.context.get("is_reply", False):
            show = attrs.get("show")
            episode = attrs.get("episode")
            if bool(show) == bool(episode):
                raise serializers.ValidationError(
                    "Exactly one of 'show' or 'episode' is required for a top-level comment."
                )
        return attrs


class CommentReportSerializer(serializers.ModelSerializer):
    reporter = serializers.SerializerMethodField()
    comment_body_preview = serializers.SerializerMethodField()

    class Meta:
        model = CommentReport
        fields = [
            "id",
            "reporter",
            "comment",
            "comment_body_preview",
            "reason",
            "details",
            "status",
            "reviewed_by",
            "reviewed_at",
            "created_at",
        ]
        read_only_fields = ["id", "status", "reviewed_by", "reviewed_at", "created_at"]

    def get_reporter(self, obj: CommentReport):
        return {"id": obj.reporter_id, "username": obj.reporter.username}

    def get_comment_body_preview(self, obj: CommentReport) -> str:
        body = "[deleted]" if obj.comment.is_deleted else obj.comment.body
        return body[:140]