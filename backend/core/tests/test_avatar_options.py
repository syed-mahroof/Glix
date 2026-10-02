from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from core.profile_views import AvatarOptionsView
from core.services import TMDBService


@pytest.mark.django_db
def test_classic_avatar_collection_is_validated_and_cached_separately():
    client = APIClient()
    client.force_authenticate(get_user_model().objects.create_user(username="avatar-test"))
    with patch("core.profile_views.safe_cache_get", return_value=None), patch("core.profile_views.safe_cache_set") as cache, patch("core.profile_views.TMDBService") as service:
        service.return_value.get_popular_characters.return_value = {"results": [{"character": "Explorer", "show_title": "Adventure", "profile_path": "/portrait.jpg"}]}
        response = client.get(reverse("profile-avatar-options"), {"collection": "classics"})
        assert response.status_code == 200
        service.return_value.get_popular_characters.assert_called_once_with(limit=48, collection="classics")
        assert cache.call_args.args[0] == f"{AvatarOptionsView.CACHE_KEY}:classics"
        service.reset_mock()
        assert client.get(reverse("profile-avatar-options"), {"collection": "invalid"}).status_code == 400
        service.assert_not_called()


def test_classic_cast_comes_from_highly_rated_titles_with_bounded_requests():
    series = {"tmdb_id": 1, "title": "Series"}
    film = {"tmdb_id": 2, "title": "Film"}
    with patch.object(TMDBService, "discover_tv", return_value={"results": [series]}) as tv, patch.object(TMDBService, "get_top_rated_movies", return_value={"results": [film]}), patch.object(TMDBService, "get_show_credits", return_value={"cast": [{"character": "Hero", "name": "Actor", "profile_path": "/hero.jpg"}]}), patch.object(TMDBService, "get_movie_credits", return_value={"cast": [{"character": "Hero", "name": "Actor", "profile_path": "/hero.jpg"}, {"character": "Lead", "profile_path": "/lead.jpg"}]}):
        result = TMDBService(api_key="test").get_popular_characters(collection="classics")
    tv.assert_called_once_with(sort_by="vote_average.desc", min_vote_count=1000)
    assert len(result["results"]) == 2
    assert result["results"][0]["actor_name"] == "Actor"
    assert result["results"][1]["media_type"] == "movie"
