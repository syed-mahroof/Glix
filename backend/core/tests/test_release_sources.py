from datetime import timedelta
from unittest.mock import Mock, patch

import pytest
from django.utils import timezone

from core.release_sources import cached_tvmaze_releases, recent_release_items, watchmode_releases
from core.services import TMDBServiceError


@pytest.fixture(autouse=True)
def isolated_cache(monkeypatch):
    values = {}
    monkeypatch.setattr("core.release_sources.safe_cache_get", lambda key: values.get(key))
    monkeypatch.setattr("core.release_sources.safe_cache_set", lambda key, value, timeout: values.update({key: value}))
    return values


def item(id):
    return {"tmdb_id": id, "media_type": "movie", "title": f"Title {id}"}


def test_two_pages_merge_and_deduplicate_free_sources(settings):
    settings.WATCHMODE_API_KEY = ""
    tmdb = Mock()
    tmdb.discover_movies.side_effect = [{"results": [item(1)], "total_pages": 2}, {"results": [item(1), item(2)]}]
    data = recent_release_items(tmdb, "movie", "IN", (8,), "flatrate")
    assert [i["tmdb_id"] for i in data["items"]] == [1, 2]
    assert data["is_stale"] is False
    assert tmdb.discover_movies.call_args.kwargs["page"] == 2


def test_failure_uses_only_same_query_backup_and_successful_empty_is_authoritative(settings, isolated_cache):
    settings.WATCHMODE_API_KEY = ""
    tmdb = Mock()
    tmdb.discover_movies.return_value = {"results": [item(1)]}
    recent_release_items(tmdb, "movie", "IN", (8,), "flatrate")
    isolated_cache.pop(next(key for key in isolated_cache if not key.endswith(":backup")))
    tmdb.discover_movies.side_effect = TMDBServiceError("Offline")
    assert recent_release_items(tmdb, "movie", "IN", (8,), "flatrate")["is_stale"]
    with pytest.raises(TMDBServiceError):
        recent_release_items(tmdb, "movie", "IN", (350,), "flatrate")
    tmdb.discover_movies.side_effect = None
    tmdb.discover_movies.return_value = {"results": []}
    assert recent_release_items(tmdb, "movie", "IN", (8,), "flatrate")["items"] == []


def test_independent_tvmaze_evidence_survives_tmdb_failure(settings):
    settings.WATCHMODE_API_KEY = ""
    tmdb = Mock()
    tmdb.discover_tv.side_effect = TMDBServiceError("Offline")
    with patch("core.release_sources.cached_tvmaze_releases", return_value=[{**item(2), "media_type": "tv", "release_source": "tvmaze"}]):
        data = recent_release_items(tmdb, "tv", "IN", (), "flatrate")
    assert data["items"][0]["release_source"] == "tvmaze"


def test_watchmode_never_substitutes_us_dates_for_india_or_bypasses_platform_filters(settings):
    settings.WATCHMODE_API_KEY = "test-only"
    with patch("core.release_sources.requests.get") as request:
        assert watchmode_releases("movie", "IN", (), "flatrate|free|ads|rent|buy") == []
        assert watchmode_releases("movie", "US", (8,), "flatrate|free|ads|rent|buy") == []
        request.assert_not_called()


def test_watchmode_validates_dates_and_keeps_other_sources_on_failure(settings):
    settings.WATCHMODE_API_KEY = "test-only"
    response = Mock()
    today = timezone.now().date()
    response.json.return_value = {"releases": [
        {"tmdb_type": "movie", "tmdb_id": 1, "title": "Valid", "source_release_date": today.isoformat()},
        {"tmdb_type": "movie", "tmdb_id": 2, "source_release_date": (today + timedelta(days=1)).isoformat()},
        {"tmdb_type": "movie", "tmdb_id": 3, "source_release_date": "unknown"},
    ]}
    with patch("core.release_sources.requests.get", return_value=response):
        assert [i["tmdb_id"] for i in watchmode_releases("movie", "US", (), "flatrate|free|ads|rent|buy")] == [1]


@pytest.mark.django_db
def test_tvmaze_requires_exact_recent_episode_and_regional_platform_evidence(isolated_cache):
    from core.models import CachedEpisode, CachedShow
    show = CachedShow.objects.create(tmdb_id=7001, title="Exact schedule", air_time_source="tvmaze_exact")
    for number in (1, 2):
        CachedEpisode.objects.create(tmdb_id=700100 + number, show=show, season_number=1, episode_number=number,
            air_datetime=timezone.now() - timedelta(days=number), air_datetime_estimated=False)
    isolated_cache[f"tmdb_show_providers_{show.pk}"] = {"results": {"IN": {"flatrate": [{"provider_id": 8, "provider_name": "Platform", "logo_path": None}]}}}
    assert len(cached_tvmaze_releases("IN", (8,), "flatrate")) == 1
    assert cached_tvmaze_releases("US", (8,), "flatrate") == []
    assert cached_tvmaze_releases("IN", (350,), "flatrate") == []
    assert cached_tvmaze_releases("IN", (8,), "rent|buy") == []
    CachedEpisode.objects.filter(show=show).update(air_datetime_estimated=True)
    assert cached_tvmaze_releases("IN", (8,), "flatrate") == []
