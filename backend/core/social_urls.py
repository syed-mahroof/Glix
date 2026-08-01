"""
backend/core/social_urls.py

URL patterns for the follow graph, user search, public profiles, and the
friends activity feed (Phase 74), included into core/urls.py — mirrors
comment_urls.py's own module pattern.

Order matters: "users/search/" must be registered before the
"users/<str:username>/" family, or "search" would itself be captured as
a username by the more general pattern.
"""

from django.urls import path

from core.social_views import (
    FollowerListView,
    FollowingListView,
    FollowToggleView,
    FriendsActivityView,
    UserProfileDetailView,
    UserSearchView,
)

urlpatterns = [
    path("users/search/", UserSearchView.as_view(), name="user-search"),
    path("feed/activity/", FriendsActivityView.as_view(), name="friends-activity"),
    path("users/<str:username>/follow/", FollowToggleView.as_view(), name="user-follow-toggle"),
    path("users/<str:username>/followers/", FollowerListView.as_view(), name="user-followers"),
    path("users/<str:username>/following/", FollowingListView.as_view(), name="user-following"),
    path("users/<str:username>/", UserProfileDetailView.as_view(), name="user-profile-detail"),
]
