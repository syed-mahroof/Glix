from datetime import timedelta
from unittest.mock import patch

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.services import TMDBService, TMDBServiceError


@pytest.fixture
def client(db):
    from django.core.cache import cache
    cache.clear()
    user = get_user_model().objects.create_user(username="availability", password="test-password")
    client = APIClient()
    client.force_authenticate(user)
    return client


def test_new_releases_combines_platform_genre_and_region(client):
    with patch("core.views.TMDBService") as service:
        service.return_value.discover_movies.return_value = {"results": [], "page": 1, "total_pages": 1}
        response = client.get(reverse("discover-filter"), {"type": "movie", "providers": "8", "region": "IN", "genre": "35", "recent": "true"})
    assert response.status_code == 200
    assert service.return_value.discover_movies.call_args.kwargs["recent_releases"] is True
    assert service.return_value.discover_movies.call_args.kwargs["genre_id"] == 35


def test_combined_movie_availability_params():
    with patch.object(TMDBService, "_request", return_value={"results": []}) as request:
        TMDBService(api_key="test").discover_movies(genre_id=35, provider_ids=(350, 8, 350), watch_region="IN", monetization="flatrate", page=2)
    params = request.call_args.kwargs["params"]
    assert params == {"page": 2, "sort_by": "popularity.desc", "with_genres": "35", "watch_region": "IN", "with_watch_providers": "8|350", "with_watch_monetization_types": "flatrate"}


@pytest.mark.parametrize("media_type", ["tv", "movie"])
def test_recent_releases_use_regional_digital_dates_or_recent_tv_air_dates(media_type):
    with patch.object(TMDBService, "_request", return_value={"results": []}) as request:
        service = TMDBService(api_key="test")
        discover = service.discover_movies if media_type == "movie" else service.discover_tv
        discover(watch_region="IN", recent_releases=True)
    params = request.call_args.kwargs["params"]
    today = timezone.now().date()
    prefix = "release_date" if media_type == "movie" else "air_date"
    assert params[f"{prefix}.gte"] == (today - timedelta(days=30)).isoformat()
    assert params[f"{prefix}.lte"] == today.isoformat()
    assert params["watch_region"] == "IN"
    if media_type == "movie":
        assert params["region"] == "IN"
        assert params["with_release_type"] == "4"


@pytest.mark.parametrize("values", [
    {"providers": "0"}, {"providers": "8|350"}, {"providers": ",8"},
    {"providers": "1,2,3,4,5,6,7,8,9"}, {"region": "IND"}, {"monetization": "invalid"},
])
def test_invalid_availability_is_rejected_before_upstream_calls(client, values):
    with patch("core.views.TMDBService") as service:
        response = client.get(reverse("discover-filter"), values)
    assert response.status_code == 400
    service.return_value.discover_movies.assert_not_called()
    service.return_value.discover_tv.assert_not_called()


def test_provider_filters_route_trending_to_discover_and_normalize_region(client):
    with patch("core.views.TMDBService") as service:
        service.return_value.discover_movies.return_value = {"results": [], "page": 1, "total_pages": 1}
        response = client.get(reverse("discover-filter"), {"type": "movie", "providers": "350,8,350", "region": "in", "genre": "35"})
    assert response.status_code == 200
    service.return_value.get_trending.assert_not_called()
    kwargs = service.return_value.discover_movies.call_args.kwargs
    assert kwargs["provider_ids"] == (8, 350)
    assert kwargs["watch_region"] == "IN"
    assert kwargs["genre_id"] == 35


def test_upstream_failure_is_retryable_error_not_empty_matches(client):
    with patch.object(TMDBService, "_request", return_value=None):
        with pytest.raises(TMDBServiceError):
            TMDBService(api_key="test").discover_movies()
    with patch("core.views.TMDBService") as service:
        service.return_value.discover_movies.side_effect = TMDBServiceError("Unavailable")
        response = client.get(reverse("discover-filter"), {"type": "movie", "providers": "8"})
    assert response.status_code == 502


def test_digital_release_rail_includes_rental_releases_and_labels_tv_dates_honestly(client):
    with patch("core.views.TMDBService") as service:
        service.return_value.discover_movies.return_value = {"results": []}
        response = client.get(reverse("discover-releases"), {"type": "movie", "region": "IN"})
        assert response.status_code == 200
        assert response.data["title"] == "New Digital Releases"
        assert service.return_value.discover_movies.call_args.kwargs["monetization"] == "flatrate|free|ads|rent|buy"
        service.return_value.discover_tv.return_value = {"results": []}
        response = client.get(reverse("discover-releases"), {"type": "tv"})
        assert "recent episodes" in response.data["subtitle"]


def test_detail_availability_merges_access_types_without_duplicate_platforms():
    platform = {"provider_id": 8, "provider_name": "Netflix", "logo_path": "/logo.png"}
    other = {"provider_id": 350, "provider_name": "Apple TV", "logo_path": None}
    result = TMDBService._regional_providers({"results": {"IN": {"flatrate": [platform], "free": [other], "rent": [other], "buy": [other]}, "US": {"flatrate": [other]}}}, "IN")
    assert len(result) == 2
    assert result[0]["access_types"] == ["flatrate"]
    assert result[1]["access_types"] == ["free", "rent", "buy"]


@pytest.mark.parametrize("name", ["discover-providers", "discover-releases"])
def test_availability_endpoints_require_authentication(name):
    assert APIClient().get(reverse(name)).status_code == 401
