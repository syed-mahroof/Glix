import pytest
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import CachedShow, CustomList, CustomListItem, MovieCache

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
def test_create_list_requires_auth(api_client):
    response = api_client.post(reverse("custom-lists"), {"name": "Movies2026"}, format="json")
    assert response.status_code == 401


@pytest.mark.django_db
def test_create_list_requires_name(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.post(reverse("custom-lists"), {"name": "  "}, format="json")
    assert response.status_code == 400


@pytest.mark.django_db
def test_create_and_list_lists(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    create_response = api_client.post(
        reverse("custom-lists"), {"name": "Movies2026", "description": "Seen in theatres"}, format="json"
    )
    assert create_response.status_code == 201
    assert create_response.data["name"] == "Movies2026"
    assert create_response.data["is_private"] is True
    assert create_response.data["item_count"] == 0

    list_response = api_client.get(reverse("custom-lists"))
    assert list_response.status_code == 200
    assert len(list_response.data) == 1
    assert list_response.data[0]["name"] == "Movies2026"


@pytest.mark.django_db
def test_toggle_item_add_then_remove(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=8001, title="Spider-Man: Brand New Day", poster_path="/x.jpg")
    custom_list = CustomList.objects.create(user=user, name="Movies2026")

    add_response = api_client.post(
        reverse("custom-list-item-toggle"),
        {"list_id": custom_list.id, "media_type": "movie", "tmdb_id": movie.tmdb_id},
        format="json",
    )
    assert add_response.status_code == 200
    assert add_response.data["added"] is True
    assert CustomListItem.objects.filter(list=custom_list).count() == 1

    membership_response = api_client.get(
        reverse("custom-list-membership"), {"media_type": "movie", "tmdb_id": movie.tmdb_id}
    )
    assert membership_response.data["list_ids"] == [custom_list.id]

    detail_response = api_client.get(reverse("custom-list-detail", args=[custom_list.id]))
    assert detail_response.data["item_count"] == 1
    assert detail_response.data["items"][0]["title"] == "Spider-Man: Brand New Day"
    assert detail_response.data["items"][0]["poster_path"] == "/x.jpg"

    remove_response = api_client.post(
        reverse("custom-list-item-toggle"),
        {"list_id": custom_list.id, "media_type": "movie", "tmdb_id": movie.tmdb_id},
        format="json",
    )
    assert remove_response.status_code == 200
    assert remove_response.data["added"] is False
    assert CustomListItem.objects.filter(list=custom_list).count() == 0


@pytest.mark.django_db
def test_toggle_item_requires_owned_list(api_client, create_user):
    owner = create_user("owner")
    other = create_user("other")
    api_client.force_authenticate(user=other)
    custom_list = CustomList.objects.create(user=owner, name="Owner's list")

    response = api_client.post(
        reverse("custom-list-item-toggle"),
        {"list_id": custom_list.id, "media_type": "movie", "tmdb_id": 123},
        format="json",
    )
    assert response.status_code == 404


@pytest.mark.django_db
def test_rename_and_delete_list(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    custom_list = CustomList.objects.create(user=user, name="Old Name")

    patch_response = api_client.patch(
        reverse("custom-list-detail", args=[custom_list.id]), {"name": "New Name"}, format="json"
    )
    assert patch_response.status_code == 200
    assert patch_response.data["name"] == "New Name"

    delete_response = api_client.delete(reverse("custom-list-detail", args=[custom_list.id]))
    assert delete_response.status_code == 204
    assert not CustomList.objects.filter(pk=custom_list.id).exists()


@pytest.mark.django_db
def test_other_user_cannot_see_or_modify_list(api_client, create_user):
    owner = create_user("owner2")
    other = create_user("other2")
    custom_list = CustomList.objects.create(user=owner, name="Private list")

    api_client.force_authenticate(user=other)
    assert api_client.get(reverse("custom-list-detail", args=[custom_list.id])).status_code == 404
    assert api_client.delete(reverse("custom-list-detail", args=[custom_list.id])).status_code == 404


@pytest.mark.django_db
def test_list_with_tv_show_item(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show = CachedShow.objects.create(tmdb_id=8002, title="Some Show", status=CachedShow.Status.RETURNING)
    custom_list = CustomList.objects.create(user=user, name="Shows To Rewatch")

    api_client.post(
        reverse("custom-list-item-toggle"),
        {"list_id": custom_list.id, "media_type": "tv", "tmdb_id": show.tmdb_id},
        format="json",
    )

    detail_response = api_client.get(reverse("custom-list-detail", args=[custom_list.id]))
    assert detail_response.data["items"][0]["media_type"] == "tv"
    assert detail_response.data["items"][0]["title"] == "Some Show"
