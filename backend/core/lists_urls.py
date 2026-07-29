"""
backend/core/lists_urls.py

URL patterns for user-created lists. Included from core/urls.py with the
same pattern used for analytics_urls.py/comment_urls.py.
"""

from django.urls import path

from core.lists_views import (
    CustomListDetailView,
    CustomListItemToggleView,
    CustomListMembershipView,
    CustomListsView,
)

urlpatterns = [
    path("lists/", CustomListsView.as_view(), name="custom-lists"),
    path("lists/<int:list_id>/", CustomListDetailView.as_view(), name="custom-list-detail"),
    path("lists/items/toggle/", CustomListItemToggleView.as_view(), name="custom-list-item-toggle"),
    path("lists/membership/", CustomListMembershipView.as_view(), name="custom-list-membership"),
]
