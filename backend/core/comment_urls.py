"""
backend/core/comment_urls.py

URL patterns for the Community & Social module, included into
core/urls.py via include() so comment routing stays self-contained.
"""

from django.urls import path

from core.comment_views import (
    CommentDetailView,
    CommentLikeToggleView,
    CommentListCreateView,
    CommentReplyListCreateView,
    CommentReportView,
    ModerationReportActionView,
    ModerationReportListView,
)

urlpatterns = [
    path("comments/", CommentListCreateView.as_view(), name="comment-list-create"),
    path("comments/<uuid:comment_id>/", CommentDetailView.as_view(), name="comment-detail"),
    path(
        "comments/<uuid:comment_id>/replies/",
        CommentReplyListCreateView.as_view(),
        name="comment-replies",
    ),
    path("comments/<uuid:comment_id>/like/", CommentLikeToggleView.as_view(), name="comment-like"),
    path(
        "comments/<uuid:comment_id>/report/",
        CommentReportView.as_view(),
        name="comment-report",
    ),
    path("moderation/reports/", ModerationReportListView.as_view(), name="moderation-reports"),
    path(
        "moderation/reports/<uuid:report_id>/resolve/",
        ModerationReportActionView.as_view(),
        name="moderation-report-resolve",
    ),
]