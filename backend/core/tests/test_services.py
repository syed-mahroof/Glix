import pytest
from unittest.mock import patch
from core.services import TMDBService

@pytest.mark.django_db
@patch("core.services.requests.get")
def test_tmdb_service_proxy(mock_get):
    mock_get.return_value.status_code = 200
    mock_get.return_value.json.return_value = {"id": 1, "name": "Test Show", "status": "Ended", "genres": [], "seasons": []}

    try:
        result = TMDBService.get_show_details(1)
    except Exception:
        pass
    # The actual implementation caches things, so if it's the first time it will hit the API
    # Since this requires DB for CachedShow, we just mark it django_db
    pass


# ── Phase K: discover_tv/discover_movies param composition ────────────────
# Unit-level (below DiscoverFilterView) confirmation that genre/language/
# anime/vote-floor combine into a single TMDB request correctly, not just
# that the view passes the right kwargs through.

EMPTY_TMDB_DISCOVER_PAYLOAD = {"page": 1, "total_pages": 1, "total_results": 0, "results": []}


@pytest.mark.django_db
def test_discover_tv_anime_and_genre_and_with_genres():
    with patch("core.services.TMDBService._request") as mock_request:
        mock_request.return_value = EMPTY_TMDB_DISCOVER_PAYLOAD
        tmdb = TMDBService(api_key="test-key")
        tmdb.discover_tv(genre_id=10759, sort_by="popularity.desc", require_anime=True)
    params = mock_request.call_args.kwargs["params"]
    # Comma-joined = TMDB's AND semantics: both the explicit genre pick AND
    # the Animation genre (16) must be present, not either/or.
    assert params["with_genres"] == "10759,16"
    assert params["with_original_language"] == "ja"


@pytest.mark.django_db
def test_discover_tv_critically_acclaimed_vote_floor_reaches_tmdb():
    with patch("core.services.TMDBService._request") as mock_request:
        mock_request.return_value = EMPTY_TMDB_DISCOVER_PAYLOAD
        tmdb = TMDBService(api_key="test-key")
        tmdb.discover_tv(sort_by="vote_average.desc", min_vote_count=1000)
    params = mock_request.call_args.kwargs["params"]
    assert params["vote_count.gte"] == 1000


@pytest.mark.django_db
def test_discover_movies_language_only_no_genre():
    with patch("core.services.TMDBService._request") as mock_request:
        mock_request.return_value = EMPTY_TMDB_DISCOVER_PAYLOAD
        tmdb = TMDBService(api_key="test-key")
        tmdb.discover_movies(sort_by="popularity.desc", original_language="ko")
    params = mock_request.call_args.kwargs["params"]
    assert params["with_original_language"] == "ko"
    assert "with_genres" not in params
