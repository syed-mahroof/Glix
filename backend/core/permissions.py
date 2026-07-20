"""
backend/core/permissions.py

Object-level permission helpers layered on top of IsAuthenticated
(the project-wide default in settings.REST_FRAMEWORK).
"""

from rest_framework.permissions import BasePermission


class IsOwner(BasePermission):
    """
    Grants access only when the object's `user` field matches the
    requesting user. Used for any endpoint that accepts a primary key
    for a row that must belong to the caller (e.g. a specific
    WatchState or EpisodeInteraction), preventing IDOR-style access
    to another user's tracking data.
    """

    message = "You do not have permission to access this resource."

    def has_object_permission(self, request, view, obj) -> bool:
        owner = getattr(obj, "user", None)
        return owner is not None and owner == request.user