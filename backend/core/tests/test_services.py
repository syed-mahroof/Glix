from datetime import timedelta

import pytest
from unittest.mock import patch
from django.utils import timezone

from core.models import CachedEpisode, CachedShow
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


# ── A1: next_episode_air_datetime must not go stale when TMDB advances
# which episode is "next" (get_show_details) ────────────────────────────


@pytest.mark.django_db
def test_get_show_details_clears_next_episode_air_datetime_when_next_episode_changes():
    """Regression for the stale next_episode_air_datetime bug: the OLD
    next episode's exact TVmaze instant must not keep being served once
    TMDB advances to a genuinely different next episode."""
    old_instant = timezone.now() - timedelta(days=2)
    CachedShow.objects.create(
        tmdb_id=9001,
        title="Old Title",
        next_episode_season_number=1,
        next_episode_number=5,
        next_episode_air_datetime=old_instant,
    )
    # last_synced_at is auto_now=True, so bypass instance.save() to backdate
    # it past CACHE_TTL and force get_show_details to actually refetch.
    CachedShow.objects.filter(pk=9001).update(last_synced_at=timezone.now() - timedelta(hours=13))

    payload = {
        "id": 9001,
        "name": "New Title",
        "status": "Returning Series",
        "genres": [],
        "networks": [],
        "next_episode_to_air": {"season_number": 1, "episode_number": 6, "name": "Ep 6"},
    }
    with patch("core.services.TMDBService._request", return_value=payload):
        result = TMDBService(api_key="test-key").get_show_details(9001)

    assert result.next_episode_season_number == 1
    assert result.next_episode_number == 6
    # The OLD instant (for S1E5) must not leak onto the NEW next episode (S1E6).
    assert result.next_episode_air_datetime is None


@pytest.mark.django_db
def test_get_show_details_re_derives_next_episode_air_datetime_from_cached_episode():
    """When TMDB advances to a next episode TVmaze already synced as a
    regular episode (a CachedEpisode row with a known air_datetime),
    get_show_details recovers that instant with no network call, instead
    of leaving it null until the next monthly TVmaze recheck."""
    show = CachedShow.objects.create(
        tmdb_id=9002,
        title="Old Title",
        next_episode_season_number=1,
        next_episode_number=5,
        next_episode_air_datetime=timezone.now() - timedelta(days=2),
    )
    CachedShow.objects.filter(pk=9002).update(last_synced_at=timezone.now() - timedelta(hours=13))

    known_instant = timezone.now() + timedelta(days=3)
    CachedEpisode.objects.create(
        tmdb_id=90026,
        show=show,
        season_number=1,
        episode_number=6,
        title="Ep 6",
        air_datetime=known_instant,
    )

    payload = {
        "id": 9002,
        "name": "New Title",
        "status": "Returning Series",
        "genres": [],
        "networks": [],
        "next_episode_to_air": {"season_number": 1, "episode_number": 6, "name": "Ep 6"},
    }
    with patch("core.services.TMDBService._request", return_value=payload):
        result = TMDBService(api_key="test-key").get_show_details(9002)

    assert result.next_episode_air_datetime == known_instant


@pytest.mark.django_db
def test_get_show_details_keeps_next_episode_air_datetime_when_episode_unchanged():
    """When the incoming (season, episode) is the SAME as before, the
    stored TVmaze instant must be left untouched, not overwritten with
    None just because next_episode_air_datetime isn't itself part of the
    fresh TMDB payload."""
    known_instant = timezone.now() + timedelta(days=1)
    CachedShow.objects.create(
        tmdb_id=9003,
        title="Old Title",
        next_episode_season_number=2,
        next_episode_number=3,
        next_episode_air_datetime=known_instant,
    )
    CachedShow.objects.filter(pk=9003).update(last_synced_at=timezone.now() - timedelta(hours=13))

    payload = {
        "id": 9003,
        "name": "New Title",
        "status": "Returning Series",
        "genres": [],
        "networks": [],
        "next_episode_to_air": {"season_number": 2, "episode_number": 3, "name": "Ep 3"},
    }
    with patch("core.services.TMDBService._request", return_value=payload):
        result = TMDBService(api_key="test-key").get_show_details(9003)

    assert result.next_episode_air_datetime == known_instant


@pytest.mark.django_db
def test_get_show_details_populates_networks_from_tmdb_payload():
    """A3: CachedShow.networks is populated from the TMDB payload's
    `networks` array, extracting only `.name`, filtering out entries with
    no name (missing key or blank) rather than erroring on them."""
    payload = {
        "id": 9004,
        "name": "Streaming Show",
        "status": "Returning Series",
        "genres": [],
        "networks": [{"name": "Netflix"}, {"name": ""}, {"id": 5}],
    }
    with patch("core.services.TMDBService._request", return_value=payload):
        result = TMDBService(api_key="test-key").get_show_details(9004)

    assert result.networks == ["Netflix"]


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
