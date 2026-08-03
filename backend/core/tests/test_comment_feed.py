"""
backend/core/tests/test_comment_feed.py

CommentFeedView (Phase 75.6) — GET /api/comments/feed/, the single-query
replacement for community.tsx's old client-side fan-out (up to 8 parallel
GET /comments/?show_id= requests, one per tracked show, merged in JS).
"""

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import CachedShow, Comment, Watchlist

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


@pytest.mark.django_db
def test_comment_feed_only_includes_tracked_shows(api_client, create_user):
    user = create_user("viewer")
    tracked_show = CachedShow.objects.create(tmdb_id=8001, title="Tracked Show", status=CachedShow.Status.ENDED)
    untracked_show = CachedShow.objects.create(tmdb_id=8002, title="Untracked Show", status=CachedShow.Status.ENDED)
    Watchlist.objects.create(user=user, show=tracked_show)

    other_user = create_user("commenter")
    Comment.objects.create(user=other_user, show=tracked_show, body="Great episode")
    Comment.objects.create(user=other_user, show=untracked_show, body="Shouldn't appear")

    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("comment-feed"))
    assert response.status_code == 200
    bodies = {row["body"] for row in response.data["results"]}
    assert bodies == {"Great episode"}


@pytest.mark.django_db
def test_comment_feed_excludes_replies(api_client, create_user):
    user = create_user("viewer2")
    show = CachedShow.objects.create(tmdb_id=8003, title="Show", status=CachedShow.Status.ENDED)
    Watchlist.objects.create(user=user, show=show)

    other_user = create_user("commenter2")
    top_level = Comment.objects.create(user=other_user, show=show, body="Top level")
    Comment.objects.create(user=other_user, show=show, body="A reply", parent=top_level)

    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("comment-feed"))
    assert response.status_code == 200
    bodies = [row["body"] for row in response.data["results"]]
    assert bodies == ["Top level"]


@pytest.mark.django_db
def test_comment_feed_empty_when_nothing_tracked(api_client, create_user):
    user = create_user("viewer3")
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("comment-feed"))
    assert response.status_code == 200
    assert response.data["results"] == []
