"""
backend/core/comment_views.py

Community & Social endpoints: comments, replies, likes, reports, and
staff moderation. Comments and replies share one model/serializer
(see comment_serializers.py); a reply is simply a Comment with
`parent` set. Pagination reuses StandardResultsPagination
(core/pagination.py) throughout rather than duplicating it.
"""

from django.db import IntegrityError, transaction
from django.db.models import Count, Exists, OuterRef
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.comment_permissions import IsCommentOwnerOrReadOnly, IsStaffUser
from core.comment_serializers import CommentReportSerializer, CommentSerializer
from core.models import Comment, CommentLike, CommentReport
from core.pagination import StandardResultsPagination


class CommentQuerysetMixin:
    """
    Shared annotation logic: like_count, reply_count, and
    is_liked_by_user are computed in the database rather than per-row
    in the serializer, so a paginated page of N comments costs one
    query instead of N+1.
    """

    def annotated_queryset(self, base_queryset):
        user = self.request.user
        return base_queryset.select_related("user", "user__profile").annotate(
            like_count_annotated=Count("likes", distinct=True),
            reply_count_annotated=Count("replies", distinct=True),
            is_liked_annotated=Exists(
                CommentLike.objects.filter(comment=OuterRef("pk"), user=user)
            ),
        )


class CommentListCreateView(CommentQuerysetMixin, generics.ListCreateAPIView):
    """
    GET  /api/comments/?show_id=<id>     — top-level comments on a show
    GET  /api/comments/?episode_id=<id>  — top-level comments on an episode
    POST /api/comments/  Body: {"show": <id>} or {"episode": <id>}, "body", "is_spoiler"?

    Only top-level comments (parent is null) are listed/created here;
    replies go through CommentReplyListCreateView below.
    """

    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        show_id = self.request.query_params.get("show_id")
        episode_id = self.request.query_params.get("episode_id")
        queryset = Comment.objects.filter(parent__isnull=True)

        if show_id:
            queryset = queryset.filter(show_id=show_id)
        elif episode_id:
            queryset = queryset.filter(episode_id=episode_id)
        else:
            queryset = queryset.none()

        return self.annotated_queryset(queryset).order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user, parent=None)


class CommentReplyListCreateView(CommentQuerysetMixin, generics.ListCreateAPIView):
    """
    GET  /api/comments/<comment_id>/replies/
    POST /api/comments/<comment_id>/replies/  Body: {"body", "is_spoiler"?}

    A reply-to-a-reply is created the same way — POST to
    /comments/<that reply's id>/replies/ — and is fetched by
    requesting that comment's replies, not auto-inlined here.
    """

    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = StandardResultsPagination

    def get_parent(self) -> Comment:
        return get_object_or_404(Comment, pk=self.kwargs["comment_id"])

    def get_queryset(self):
        parent = self.get_parent()
        queryset = Comment.objects.filter(parent=parent)
        return self.annotated_queryset(queryset).order_by("created_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["is_reply"] = True
        return context

    def perform_create(self, serializer):
        parent = self.get_parent()
        serializer.save(
            user=self.request.user,
            parent=parent,
            show=parent.show,
            episode=parent.episode,
        )


class CommentDetailView(CommentQuerysetMixin, generics.RetrieveUpdateDestroyAPIView):
    """
    PATCH  /api/comments/<comment_id>/  Body: {"body"?, "is_spoiler"?} — owner only
    DELETE /api/comments/<comment_id>/  — owner only, soft delete

    PATCH sets is_edited=True. DELETE never removes the row (replies
    would be orphaned); it flips is_deleted/deleted_at, and the
    serializer substitutes a placeholder body for deleted comments.
    """

    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated, IsCommentOwnerOrReadOnly]
    lookup_url_kwarg = "comment_id"

    def get_queryset(self):
        return self.annotated_queryset(Comment.objects.all())

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["is_reply"] = True  # skip top-level show/episode validation on edit
        return context

    def perform_update(self, serializer):
        serializer.save(is_edited=True)

    def destroy(self, request, *args, **kwargs):
        comment = self.get_object()
        comment.is_deleted = True
        comment.deleted_at = timezone.now()
        comment.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class CommentLikeToggleView(APIView):
    """POST /api/comments/<comment_id>/like/ — toggles a like, mirrors WatchStateToggleView's presence-based pattern."""

    permission_classes = [IsAuthenticated]

    def post(self, request, comment_id):
        comment = get_object_or_404(Comment, pk=comment_id)
        existing = CommentLike.objects.filter(user=request.user, comment=comment).first()

        if existing is not None:
            existing.delete()
            liked = False
        else:
            try:
                with transaction.atomic():
                    CommentLike.objects.create(user=request.user, comment=comment)
                liked = True
            except IntegrityError:
                # Race: another request from the same user landed first.
                liked = True

        return Response(
            {
                "comment_id": str(comment.id),
                "liked": liked,
                "like_count": comment.likes.count(),
            },
            status=status.HTTP_200_OK,
        )


class CommentReportView(APIView):
    """
    POST /api/comments/<comment_id>/report/
    Body: {"reason": "SPAM"|"HARASSMENT"|"SPOILER"|"OFF_TOPIC"|"OTHER", "details"?: str}

    One PENDING report per (user, comment) at a time — resubmitting
    while a prior report from this user is still pending returns 409
    rather than creating a duplicate; a fresh report is allowed again
    once the prior one is resolved (removed/dismissed).
    """

    permission_classes = [IsAuthenticated]

    def post(self, request, comment_id):
        comment = get_object_or_404(Comment, pk=comment_id)
        reason = request.data.get("reason")
        if reason not in CommentReport.Reason.values:
            return Response(
                {"detail": "A valid 'reason' is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        existing_pending = CommentReport.objects.filter(
            reporter=request.user, comment=comment, status=CommentReport.Status.PENDING
        ).first()
        if existing_pending is not None:
            return Response(
                {"detail": "You already have a pending report on this comment."},
                status=status.HTTP_409_CONFLICT,
            )

        report = CommentReport.objects.create(
            reporter=request.user,
            comment=comment,
            reason=reason,
            details=request.data.get("details", ""),
        )
        serializer = CommentReportSerializer(report)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ModerationReportListView(generics.ListAPIView):
    """GET /api/moderation/reports/?status=PENDING (default PENDING) — staff only."""

    serializer_class = CommentReportSerializer
    permission_classes = [IsAuthenticated, IsStaffUser]
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        status_filter = self.request.query_params.get("status", CommentReport.Status.PENDING)
        return (
            CommentReport.objects.filter(status=status_filter)
            .select_related("reporter", "comment")
            .order_by("-created_at")
        )


class ModerationReportActionView(APIView):
    """
    POST /api/moderation/reports/<report_id>/resolve/
    Body: {"action": "remove"|"dismiss"}

    "remove" soft-deletes the reported comment and resolves every
    PENDING report against it as REMOVED (not just this one) — one
    moderation decision clears the whole queue for that comment rather
    than requiring the moderator to action each report individually.
    "dismiss" only resolves this specific report.
    """

    permission_classes = [IsAuthenticated, IsStaffUser]

    def post(self, request, report_id):
        report = get_object_or_404(CommentReport, pk=report_id)
        action = request.data.get("action")
        if action not in ("remove", "dismiss"):
            return Response(
                {"detail": "action must be 'remove' or 'dismiss'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        now = timezone.now()

        with transaction.atomic():
            if action == "remove":
                comment = report.comment
                comment.is_deleted = True
                comment.deleted_at = now
                comment.save(update_fields=["is_deleted", "deleted_at"])

                CommentReport.objects.filter(
                    comment=comment, status=CommentReport.Status.PENDING
                ).update(
                    status=CommentReport.Status.REMOVED,
                    reviewed_by=request.user,
                    reviewed_at=now,
                )
            else:
                report.status = CommentReport.Status.DISMISSED
                report.reviewed_by = request.user
                report.reviewed_at = now
                report.save(update_fields=["status", "reviewed_by", "reviewed_at"])

        return Response({"report_id": str(report.id), "status": action}, status=status.HTTP_200_OK)