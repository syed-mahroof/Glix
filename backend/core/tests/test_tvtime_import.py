"""
Phase B: chunked/resumable, diff-aware TV Time import.

Covers the four scenarios the fix prompt asked for explicitly: a fresh
import, a forced interruption mid-import (simulated at the chunk
boundary — see run_tvtime_import's chunking docstring for why that's the
real interruption point now), a re-import of the same payload, and
confirmation of no duplicate writes / correct final counts.

The TMDB network boundary is faked at TMDBService._request, the single
choke point every higher-level TMDBService method (get_show_details,
get_season_episodes, find_by_external_id, get_movie_details) already
funnels through — everything above that (caching, CachedShow/CachedEpisode
writes, parsing) runs for real, so these tests exercise genuine DB state,
not a mocked shortcut.
"""
import re

import pytest
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APIClient

from core.models import ImportJob, Watchlist, WatchState
from core.tasks import IMPORT_CHUNK_SIZE, run_tvtime_import

User = get_user_model()


def _fake_tmdb_request(path, params=None, use_cache=False, cache_ttl=3600):
    """Deterministic stand-in for TMDB: tmdb_id == the numeric external id."""
    params = params or {}

    m = re.fullmatch(r"/find/([^/]+)", path)
    if m:
        external_id = m.group(1)
        source = params.get("external_source")
        if source == "tvdb_id":
            return {"tv_results": [{"id": int(external_id)}], "movie_results": []}
        if source == "imdb_id":
            return {"tv_results": [], "movie_results": [{"id": int(external_id.lstrip("t"))}]}
        return {"tv_results": [], "movie_results": []}

    m = re.fullmatch(r"/tv/(\d+)/season/(\d+)", path)
    if m:
        tmdb_id, season_num = int(m.group(1)), int(m.group(2))
        return {
            "episodes": [
                {
                    "id": tmdb_id * 1000 + season_num * 10 + 1,
                    "season_number": season_num,
                    "episode_number": 1,
                    "name": "Episode 1",
                    "overview": "",
                    "air_date": "2020-01-02",
                    "runtime": 30,
                    "still_path": None,
                }
            ]
        }

    m = re.fullmatch(r"/tv/(\d+)", path)
    if m:
        tmdb_id = int(m.group(1))
        return {
            "id": tmdb_id,
            "name": f"Show {tmdb_id}",
            "overview": "",
            "poster_path": None,
            "backdrop_path": None,
            "first_air_date": "2020-01-01",
            "status": "Ended",
            "vote_average": 8.0,
            "number_of_seasons": 1,
            "number_of_episodes": 1,
            "original_language": "en",
            "genres": [],
        }

    m = re.fullmatch(r"/movie/(\d+)", path)
    if m:
        tmdb_id = int(m.group(1))
        return {
            "id": tmdb_id,
            "title": f"Movie {tmdb_id}",
            "overview": "",
            "poster_path": None,
            "backdrop_path": None,
            "release_date": "2019-01-01",
            "runtime": 100,
            "genres": [],
            "vote_average": 7.0,
            "original_language": "en",
        }

    raise AssertionError(f"Unexpected TMDB path in test: {path} params={params}")


def _show_item(tvdb_id, watched=True):
    return {
        "title": f"Show {tvdb_id}",
        "tvdb_id": tvdb_id,
        "imdb_id": None,
        "seasons": [
            {
                "season_number": 1,
                "episodes": [
                    {"episode_number": 1, "is_watched": watched, "watched_at": "2021-01-01T00:00:00Z"},
                ],
            }
        ],
    }


def _movie_item(numeric_id, watched=True):
    return {
        "title": f"Movie {numeric_id}",
        "tvdb_id": None,
        "imdb_id": f"tt{numeric_id}",
        "is_watched": watched,
        "watched_at": "2021-02-01T00:00:00Z",
    }


@pytest.fixture
def user(db):
    return User.objects.create_user(username="importer", password="password")


@pytest.fixture(autouse=True)
def fake_tmdb():
    with patch("core.services.TMDBService._request", side_effect=_fake_tmdb_request):
        yield


@pytest.mark.django_db
def test_fresh_import_success(user):
    job = ImportJob.objects.create(
        user=user,
        payload={"shows": [_show_item(1), _show_item(2)], "movies": [_movie_item(101)]},
        total=3,
    )

    run_tvtime_import(str(job.id))
    job.refresh_from_db()

    assert job.status == ImportJob.Status.SUCCESS
    assert job.processed == 3
    assert job.shows_imported == 2
    assert job.shows_skipped == 0
    assert job.movies_imported == 1
    assert job.episodes_marked == 2
    assert job.payload == {}
    assert Watchlist.objects.filter(user=user).count() == 2
    assert WatchState.objects.filter(user=user).count() == 2


@pytest.mark.django_db
def test_chunked_interruption_and_resume(user):
    """A library bigger than one chunk must not process everything in one
    invocation, and must resume — not restart — on the next one."""
    n_shows = IMPORT_CHUNK_SIZE + 5
    payload = {"shows": [_show_item(i) for i in range(1, n_shows + 1)], "movies": []}
    job = ImportJob.objects.create(user=user, payload=payload, total=n_shows)

    with patch("core.tasks.run_tvtime_import.apply_async") as mock_apply_async:
        run_tvtime_import(str(job.id))

    job.refresh_from_db()
    assert job.status == ImportJob.Status.RUNNING
    assert job.processed == IMPORT_CHUNK_SIZE
    assert job.shows_imported == IMPORT_CHUNK_SIZE
    assert job.payload != {}  # still needed for the next chunk
    mock_apply_async.assert_called_once_with(args=[str(job.id)], countdown=1)

    # Simulate the next worker pickup instead of actually hitting a broker.
    run_tvtime_import(str(job.id))
    job.refresh_from_db()

    assert job.status == ImportJob.Status.SUCCESS
    assert job.processed == n_shows
    assert job.shows_imported == n_shows
    assert job.payload == {}
    assert Watchlist.objects.filter(user=user).count() == n_shows


@pytest.mark.django_db
def test_reimport_same_payload_skips_already_done_work_no_duplicates(user):
    """Re-running an import for shows already fully imported/marked must
    not re-fetch their seasons and must not create duplicate WatchState
    rows — the core diff-aware requirement."""
    payload = {"shows": [_show_item(1), _show_item(2)], "movies": [_movie_item(101)]}

    job1 = ImportJob.objects.create(user=user, payload=dict(payload), total=3)
    run_tvtime_import(str(job1.id))
    job1.refresh_from_db()
    assert job1.status == ImportJob.Status.SUCCESS
    assert job1.episodes_marked == 2

    watch_state_count_after_first = WatchState.objects.filter(user=user).count()
    episode_ids_after_first = set(
        WatchState.objects.filter(user=user).values_list("episode_id", flat=True)
    )

    job2 = ImportJob.objects.create(user=user, payload=dict(payload), total=3)
    with patch("core.services.TMDBService._request", side_effect=_fake_tmdb_request) as mock_request:
        run_tvtime_import(str(job2.id))

    season_calls = [
        call for call in mock_request.call_args_list
        if re.fullmatch(r"/tv/\d+/season/\d+", call.args[0])
    ]
    assert season_calls == []  # nothing already-imported needed a re-fetch

    job2.refresh_from_db()
    assert job2.status == ImportJob.Status.SUCCESS
    assert job2.episodes_marked == 0  # nothing new to mark
    assert job2.shows_imported == 2  # still counted as "processed successfully", not skipped
    assert WatchState.objects.filter(user=user).count() == watch_state_count_after_first
    assert set(
        WatchState.objects.filter(user=user).values_list("episode_id", flat=True)
    ) == episode_ids_after_first


@pytest.mark.django_db
def test_import_job_status_view_shows_progress(user):
    job = ImportJob.objects.create(
        user=user, payload={"shows": [_show_item(1)], "movies": []}, total=1,
        status=ImportJob.Status.RUNNING, processed=1, shows_imported=1,
    )
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get(reverse("import-status", args=[job.id]))

    assert response.status_code == 200
    assert response.data["status"] == "RUNNING"
    assert response.data["processed"] == 1
    assert response.data["total"] == 1


@pytest.mark.django_db
def test_view_resumes_matching_failed_job_instead_of_restarting(user):
    payload = {"shows": [_show_item(1), _show_item(2), _show_item(3)], "movies": []}
    failed_job = ImportJob.objects.create(
        user=user,
        payload=payload,
        total=3,
        status=ImportJob.Status.FAILED,
        processed=2,
        shows_imported=2,
        detail="Import stalled and was abandoned (worker restarted mid-run). Please try again.",
    )

    client = APIClient()
    client.force_authenticate(user=user)
    with patch("core.views.run_tvtime_import.delay") as mock_delay:
        response = client.post(reverse("import-tvtime"), data=payload, format="json")

    assert response.status_code == 202
    assert response.data["job_id"] == str(failed_job.id)
    assert response.data["status"] == "RUNNING"
    mock_delay.assert_called_once_with(str(failed_job.id))

    failed_job.refresh_from_db()
    assert failed_job.status == ImportJob.Status.RUNNING
    assert failed_job.processed == 2  # cursor preserved, not reset to 0
    assert failed_job.payload == payload


@pytest.mark.django_db
def test_view_starts_fresh_job_when_failed_job_payload_differs(user):
    old_payload = {"shows": [_show_item(1)], "movies": []}
    ImportJob.objects.create(
        user=user,
        payload=old_payload,
        total=1,
        status=ImportJob.Status.FAILED,
        processed=1,
    )

    new_payload = {"shows": [_show_item(1), _show_item(99)], "movies": []}
    client = APIClient()
    client.force_authenticate(user=user)
    with patch("core.views.run_tvtime_import.delay") as mock_delay:
        response = client.post(reverse("import-tvtime"), data=new_payload, format="json")

    assert response.status_code == 202
    new_job = ImportJob.objects.get(id=response.data["job_id"])
    assert new_job.payload == new_payload
    assert new_job.processed == 0
    assert new_job.status == ImportJob.Status.PENDING
    mock_delay.assert_called_once_with(str(new_job.id))
