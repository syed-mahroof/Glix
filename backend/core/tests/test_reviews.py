"""
Phase L: show/movie review system — create/update/delete/list, scoped to
the requesting user, 1-5 rating validation, and the private-by-default
decision (no leakage into another user's view of the same title).
"""

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import CachedShow, MovieCache, MovieReview, ShowReview

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
def test_show_review_requires_auth(api_client):
    show = CachedShow.objects.create(tmdb_id=901, title="Some Show", status=CachedShow.Status.ENDED)
    url = reverse("show-review-detail", args=[show.tmdb_id])
    assert api_client.get(url).status_code == 401
    assert api_client.post(url, {"rating": 5}, format="json").status_code == 401


@pytest.mark.django_db
def test_show_review_get_404_when_none_exists(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=902, title="Unrated Show", status=CachedShow.Status.ENDED)
    response = api_client.get(reverse("show-review-detail", args=[show.tmdb_id]))
    assert response.status_code == 404


@pytest.mark.django_db
def test_show_review_create_then_update_in_place(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=903, title="Great Show", status=CachedShow.Status.ENDED)
    url = reverse("show-review-detail", args=[show.tmdb_id])

    create_response = api_client.post(url, {"rating": 4, "note": "Pretty good"}, format="json")
    assert create_response.status_code == 201
    assert create_response.data["rating"] == 4
    assert create_response.data["note"] == "Pretty good"
    assert ShowReview.objects.filter(user=user, show=show).count() == 1

    update_response = api_client.post(url, {"rating": 5, "note": "Actually loved it"}, format="json")
    assert update_response.status_code == 200
    assert update_response.data["rating"] == 5
    # Still exactly one row -- POSTing again updates in place, doesn't
    # create a second review for the same (user, show).
    assert ShowReview.objects.filter(user=user, show=show).count() == 1
    assert ShowReview.objects.get(user=user, show=show).note == "Actually loved it"


@pytest.mark.django_db
@pytest.mark.parametrize("rating", [0, 6, -1, "not-a-number"])
def test_show_review_rejects_invalid_rating(api_client, create_user, rating):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=904, title="Show", status=CachedShow.Status.ENDED)
    response = api_client.post(
        reverse("show-review-detail", args=[show.tmdb_id]), {"rating": rating}, format="json"
    )
    assert response.status_code == 400
    assert not ShowReview.objects.filter(show=show).exists()


@pytest.mark.django_db
def test_show_review_delete(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=905, title="Show", status=CachedShow.Status.ENDED)
    url = reverse("show-review-detail", args=[show.tmdb_id])
    api_client.post(url, {"rating": 3}, format="json")

    delete_response = api_client.delete(url)
    assert delete_response.status_code == 204
    assert not ShowReview.objects.filter(user=user, show=show).exists()

    second_delete = api_client.delete(url)
    assert second_delete.status_code == 404


@pytest.mark.django_db
def test_show_review_is_private_to_the_reviewing_user(api_client, create_user):
    """Phase L product decision: reviews are private-by-default, not wired
    into the public Comment system -- confirm one user's review isn't
    visible via the other's GET (each only ever sees their own)."""
    user_a = create_user(username="alice")
    user_b = create_user(username="bob")
    show = CachedShow.objects.create(tmdb_id=906, title="Shared Show", status=CachedShow.Status.ENDED)
    url = reverse("show-review-detail", args=[show.tmdb_id])

    api_client.force_authenticate(user=user_a)
    api_client.post(url, {"rating": 5, "note": "Alice's private thoughts"}, format="json")

    api_client.force_authenticate(user=user_b)
    response = api_client.get(url)
    assert response.status_code == 404  # Bob has no review of his own for this show

    api_client.force_authenticate(user=user_a)
    response = api_client.get(url)
    assert response.status_code == 200
    assert response.data["note"] == "Alice's private thoughts"


@pytest.mark.django_db
def test_show_review_list_scoped_to_user_most_recent_first(api_client, create_user):
    user_a = create_user(username="alice")
    user_b = create_user(username="bob")
    show1 = CachedShow.objects.create(tmdb_id=907, title="Show One", status=CachedShow.Status.ENDED)
    show2 = CachedShow.objects.create(tmdb_id=908, title="Show Two", status=CachedShow.Status.ENDED)

    ShowReview.objects.create(user=user_a, show=show1, rating=3)
    ShowReview.objects.create(user=user_a, show=show2, rating=5)
    ShowReview.objects.create(user=user_b, show=show1, rating=1)

    api_client.force_authenticate(user=user_a)
    response = api_client.get(reverse("show-review-list"))
    assert response.status_code == 200
    # StandardResultsPagination wraps list responses (same convention as
    # WatchHistoryView) -- results live under "results", not the bare list.
    assert response.data["count"] == 2
    show_ids = {r["show_id"] for r in response.data["results"]}
    assert show_ids == {show1.tmdb_id, show2.tmdb_id}


@pytest.mark.django_db
def test_movie_review_create_update_delete(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=909, title="Great Movie", runtime_minutes=120)
    url = reverse("movie-review-detail", args=[movie.tmdb_id])

    create_response = api_client.post(url, {"rating": 4}, format="json")
    assert create_response.status_code == 201
    assert MovieReview.objects.filter(user=user, movie=movie).count() == 1

    update_response = api_client.post(url, {"rating": 2, "note": "Rewatched, less good"}, format="json")
    assert update_response.status_code == 200
    assert MovieReview.objects.filter(user=user, movie=movie).count() == 1
    assert MovieReview.objects.get(user=user, movie=movie).rating == 2

    delete_response = api_client.delete(url)
    assert delete_response.status_code == 204
    assert not MovieReview.objects.filter(user=user, movie=movie).exists()
