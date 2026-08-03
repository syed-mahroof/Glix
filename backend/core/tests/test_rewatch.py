"""
backend/core/tests/test_rewatch.py

Rewatch tracking (Phase 75.7) — a parallel system to WatchState/
MovieWatchState (see ShowRewatch's model docstring for why). The critical
property under test throughout this file: nothing about rewatch ever
touches WatchState/MovieWatchState or their derived counts (episodes_watched,
badges, streak) — only total_time_watched/total_rewatch_time_watched move.
"""

from datetime import timedelta

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (
    CachedEpisode,
    CachedShow,
    MovieCache,
    MovieRewatch,
    MovieWatchState,
    RewatchEpisodeState,
    ShowRewatch,
    UserProfile,
    WatchState,
)

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


def _make_show_with_episodes(tmdb_id, episode_count=3, runtime=20):
    show = CachedShow.objects.create(tmdb_id=tmdb_id, title=f"Show {tmdb_id}", status=CachedShow.Status.ENDED)
    episodes = [
        CachedEpisode.objects.create(
            tmdb_id=tmdb_id * 100 + n,
            show=show,
            season_number=1,
            episode_number=n,
            title=f"Episode {n}",
            air_date=timezone.now().date() - timedelta(days=30),
            runtime_minutes=runtime,
        )
        for n in range(1, episode_count + 1)
    ]
    return show, episodes


def _watch_all(user, episodes):
    for ep in episodes:
        WatchState.objects.create(user=user, episode=ep)


# ─── Starting a round ───────────────────────────────────────────────────

@pytest.mark.django_db
def test_start_rewatch_rejected_until_every_aired_episode_watched(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9001, episode_count=3)
    WatchState.objects.create(user=user, episode=episodes[0])  # only 1 of 3

    response = api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    assert response.status_code == 400
    assert not ShowRewatch.objects.filter(user=user, show=show).exists()


@pytest.mark.django_db
def test_start_rewatch_succeeds_at_round_two_after_full_watch(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9002)
    _watch_all(user, episodes)

    response = api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    assert response.status_code == 201
    assert response.data["round_number"] == 2
    assert ShowRewatch.objects.filter(user=user, show=show, round_number=2, completed_at__isnull=True).exists()


@pytest.mark.django_db
def test_start_rewatch_rejected_while_a_round_is_already_active(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9003)
    _watch_all(user, episodes)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))

    second_start = api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    assert second_start.status_code == 400
    assert ShowRewatch.objects.filter(user=user, show=show).count() == 1


# ─── Ticking episodes within a round ────────────────────────────────────

@pytest.mark.django_db
def test_rewatch_episode_toggle_leaves_watchstate_and_episode_count_untouched(api_client, create_user):
    """The core safety property: ticking a rewatch episode must not create,
    delete, or otherwise disturb any WatchState row — episodes_watched
    (and everything derived from it: badges, streak, history) must be
    byte-identical before and after a rewatch tick."""
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9004, episode_count=3, runtime=25)
    _watch_all(user, episodes)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))

    watchstate_ids_before = set(
        WatchState.objects.filter(user=user, episode__show=show).values_list("id", flat=True)
    )
    profile_before = UserProfile.objects.get(user=user)

    response = api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    assert response.status_code == 200
    assert response.data["watched"] is True

    watchstate_ids_after = set(
        WatchState.objects.filter(user=user, episode__show=show).values_list("id", flat=True)
    )
    assert watchstate_ids_after == watchstate_ids_before

    profile_after = UserProfile.objects.get(user=user)
    assert profile_after.total_time_watched == profile_before.total_time_watched + 25
    assert profile_after.total_rewatch_time_watched == profile_before.total_rewatch_time_watched + 25


@pytest.mark.django_db
def test_rewatch_episode_toggle_untick_reverses_counters(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9005, episode_count=2, runtime=30)
    _watch_all(user, episodes)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))

    profile_before = UserProfile.objects.get(user=user)
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    untick_response = api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    assert untick_response.status_code == 200
    assert untick_response.data["watched"] is False

    profile_after = UserProfile.objects.get(user=user)
    assert profile_after.total_time_watched == profile_before.total_time_watched
    assert profile_after.total_rewatch_time_watched == profile_before.total_rewatch_time_watched
    rewatch = ShowRewatch.objects.get(user=user, show=show)
    assert not RewatchEpisodeState.objects.filter(rewatch=rewatch, episode=episodes[0]).exists()


@pytest.mark.django_db
def test_rewatch_episode_toggle_rejected_without_active_round(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9006)
    _watch_all(user, episodes)
    # No round started.

    response = api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    assert response.status_code == 400


@pytest.mark.django_db
def test_rewatch_round_completes_once_every_aired_episode_is_ticked(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9007, episode_count=2)
    _watch_all(user, episodes)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))

    first = api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    assert first.data["round_completed"] is False

    second = api_client.post(reverse("rewatch-episode-toggle", args=[episodes[1].tmdb_id]))
    assert second.data["round_completed"] is True
    rewatch = ShowRewatch.objects.get(user=user, show=show)
    assert rewatch.completed_at is not None


@pytest.mark.django_db
def test_untick_after_completion_reopens_the_round(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9008, episode_count=1)
    _watch_all(user, episodes)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    assert ShowRewatch.objects.get(user=user, show=show).completed_at is not None

    untick = api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))
    assert untick.data["round_completed"] is False
    assert ShowRewatch.objects.get(user=user, show=show).completed_at is None


# ─── Cancelling a round ─────────────────────────────────────────────────

@pytest.mark.django_db
def test_cancel_rewatch_reverts_counters_and_deletes_episode_states_but_not_watchstate(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9009, episode_count=2, runtime=15)
    _watch_all(user, episodes)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))

    profile_before = UserProfile.objects.get(user=user)
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))

    cancel_response = api_client.delete(reverse("show-rewatch-detail", args=[show.tmdb_id]))
    assert cancel_response.status_code == 204

    profile_after = UserProfile.objects.get(user=user)
    assert profile_after.total_time_watched == profile_before.total_time_watched
    assert profile_after.total_rewatch_time_watched == profile_before.total_rewatch_time_watched
    assert not ShowRewatch.objects.filter(user=user, show=show).exists()
    assert not RewatchEpisodeState.objects.filter(episode=episodes[0]).exists()
    # WatchState from the ORIGINAL watch-through must survive untouched.
    assert WatchState.objects.filter(user=user, episode__in=episodes).count() == 2


@pytest.mark.django_db
def test_cancel_rewatch_404_when_no_active_round(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, _episodes = _make_show_with_episodes(9010)

    response = api_client.delete(reverse("show-rewatch-detail", args=[show.tmdb_id]))
    assert response.status_code == 404


# ─── Detail view ────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_rewatch_detail_view_reports_active_round_and_ticked_episodes(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9011, episode_count=2)
    _watch_all(user, episodes)

    empty = api_client.get(reverse("show-rewatch-detail", args=[show.tmdb_id]))
    assert empty.data["active_rewatch"] is None

    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))

    detail = api_client.get(reverse("show-rewatch-detail", args=[show.tmdb_id]))
    assert detail.data["active_rewatch"]["round_number"] == 2
    assert detail.data["active_rewatch"]["watched_episode_ids"] == [episodes[0].tmdb_id]
    assert detail.data["active_rewatch"]["aired_episode_count"] == 2


# ─── Movie rewatch ──────────────────────────────────────────────────────

@pytest.mark.django_db
def test_movie_rewatch_blocked_until_watched(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=9101, title="Movie", runtime_minutes=100)

    response = api_client.post(reverse("movie-rewatch", args=[movie.tmdb_id]))
    assert response.status_code == 400
    assert not MovieRewatch.objects.filter(user=user, movie=movie).exists()


@pytest.mark.django_db
def test_movie_rewatch_create_accumulates_and_delete_removes_most_recent(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=9102, title="Movie", runtime_minutes=90)
    MovieWatchState.objects.create(user=user, movie=movie)
    profile_after_first_watch = UserProfile.objects.get(user=user)

    first = api_client.post(reverse("movie-rewatch", args=[movie.tmdb_id]))
    assert first.status_code == 201
    assert first.data["rewatch_count"] == 1

    second = api_client.post(reverse("movie-rewatch", args=[movie.tmdb_id]))
    assert second.status_code == 201
    assert second.data["rewatch_count"] == 2

    profile = UserProfile.objects.get(user=user)
    assert profile.total_time_watched == profile_after_first_watch.total_time_watched + 180
    assert profile.total_rewatch_time_watched == 180

    delete_response = api_client.delete(reverse("movie-rewatch", args=[movie.tmdb_id]))
    assert delete_response.status_code == 200
    assert delete_response.data["rewatch_count"] == 1
    profile = UserProfile.objects.get(user=user)
    assert profile.total_rewatch_time_watched == 90
    # The original MovieWatchState (first watch) must survive untouched.
    assert MovieWatchState.objects.filter(user=user, movie=movie).exists()


@pytest.mark.django_db
def test_movie_rewatch_delete_404_when_none_exist(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=9103, title="Movie", runtime_minutes=90)
    MovieWatchState.objects.create(user=user, movie=movie)

    response = api_client.delete(reverse("movie-rewatch", args=[movie.tmdb_id]))
    assert response.status_code == 404


# ─── Watchlist serializer surfacing active_rewatch / rewatch_count ─────

@pytest.mark.django_db
def test_watchlist_response_surfaces_active_rewatch(api_client, create_user):
    from core.models import Watchlist

    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9201, episode_count=2)
    _watch_all(user, episodes)
    Watchlist.objects.create(user=user, show=show)
    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    api_client.post(reverse("rewatch-episode-toggle", args=[episodes[0].tmdb_id]))

    response = api_client.get(reverse("watchlist"), {"page_size": "all"})
    assert response.status_code == 200
    all_entries = (
        response.data["to_watch"]["results"]
        + response.data["up_to_date"]["results"]
        + response.data["archived"]["results"]
    )
    entry = next(e for e in all_entries if e["show"]["tmdb_id"] == show.tmdb_id)
    assert entry["active_rewatch"] is not None
    assert entry["active_rewatch"]["round_number"] == 2
    assert entry["active_rewatch"]["watched_episode_count"] == 1
    assert entry["active_rewatch"]["aired_episode_count"] == 2


@pytest.mark.django_db
def test_movie_watchlist_response_surfaces_rewatch_count(api_client, create_user):
    from core.models import MovieWatchlist

    user = create_user()
    api_client.force_authenticate(user=user)
    movie = MovieCache.objects.create(tmdb_id=9202, title="Movie", runtime_minutes=90)
    MovieWatchState.objects.create(user=user, movie=movie)
    MovieWatchlist.objects.create(user=user, movie=movie)
    api_client.post(reverse("movie-rewatch", args=[movie.tmdb_id]))

    response = api_client.get(reverse("movies-watchlist"))
    assert response.status_code == 200
    entry = next(
        e for e in (response.data["watch_next"] + response.data["watched"]) if e["movie"]["tmdb_id"] == movie.tmdb_id
    )
    assert entry["rewatch_count"] == 1


# ─── Transaction-rollback style integrity check (plan's own verification) ──

@pytest.mark.django_db
def test_full_rewatch_flow_never_touches_first_watch_state(api_client, create_user):
    """Mirrors the plan's own verification step: start a round, tick every
    episode, and confirm WatchState rows / episodes_watched are exactly
    what they were before, while total_time_watched and
    total_rewatch_time_watched both moved."""
    user = create_user()
    api_client.force_authenticate(user=user)
    show, episodes = _make_show_with_episodes(9301, episode_count=4, runtime=20)
    _watch_all(user, episodes)

    watchstate_snapshot_before = set(
        WatchState.objects.filter(user=user, episode__show=show).values_list("episode_id", flat=True)
    )
    profile_before = UserProfile.objects.get(user=user)

    api_client.post(reverse("show-rewatch-start", args=[show.tmdb_id]))
    for ep in episodes:
        result = api_client.post(reverse("rewatch-episode-toggle", args=[ep.tmdb_id]))
        assert result.status_code == 200

    watchstate_snapshot_after = set(
        WatchState.objects.filter(user=user, episode__show=show).values_list("episode_id", flat=True)
    )
    assert watchstate_snapshot_after == watchstate_snapshot_before

    profile_after = UserProfile.objects.get(user=user)
    assert profile_after.total_time_watched == profile_before.total_time_watched + 80
    assert profile_after.total_rewatch_time_watched == profile_before.total_rewatch_time_watched + 80
    assert ShowRewatch.objects.get(user=user, show=show).completed_at is not None
