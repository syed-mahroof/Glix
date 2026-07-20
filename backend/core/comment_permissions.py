"""
backend/core/comment_permissions.py

Permission classes for the Community & Social module.
"""

from rest_framework.permissions import SAFE_METHODS, BasePermission


class IsCommentOwnerOrReadOnly(BasePermission):
    """Edit/delete only the comment's own author; everyone authenticated can read."""

    message = "You can only edit or delete your own comments."

    def has_object_permission(self, request, view, obj) -> bool:
        if request.method in SAFE_METHODS:
            return True
        return obj.user_id == request.user.id


class IsStaffUser(BasePermission):
    """
    Gates moderation endpoints. No custom role system exists in the
    project yet — Django's built-in `is_staff` is the source of truth
    until one is introduced.
    """

    message = "Moderator access required."

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)