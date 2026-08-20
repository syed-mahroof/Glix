import pytest
from django.core.cache import cache
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import (
    CachedEpisode,
    CachedShow,
    MovieCache,
    MovieReview,
    MovieWatchlist,
    MovieWatchState,
    Watchlist,
    WatchState,
)

User = get_user_model()


@pytest.fixture(autouse=True)
def clear_cache():
    # The response cache (core/cache_keys.py) is process-wide Redis, not
    # per-test-transaction — without this, a cached response from an
    # earlier test in the same run could leak into a later one.
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user


# ── WatchlistView (page_size=all) response cache ───────────────────────────
#
# These use django_db(transaction=True) rather than the plain django_db
# marker: the cache invalidation is wired through signals.py's
# transaction.on_commit() (deliberately — see that file's comment on why),
# and on_commit callbacks never fire under the default test-transaction
# wrapping (each test runs inside an outer atomic block that's rolled back,
# never committed, so anything deferred to "on commit" is silently
# dropped). transaction=True makes Django actually commit for real, which
# is what a live request does too — this is Django's own documented way to
# test on_commit behavior, not a workaround for a real bug.

@pytest.mark.django_db(transaction=True)
def test_watchlist_all_reflects_new_show_after_cache_bust(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    url = reverse("watchlist") + "?page_size=all"

    # Prime the cache with an empty watchlist.
    response = api_client.get(url)
    assert response.status_code == 200
    assert response.data["to_watch"]["count"] == 0

    show = CachedShow.objects.create(tmdb_id=5001, title="Cache Test Show", status=CachedShow.Status.RETURNING)
    Watchlist.objects.create(user=user, show=show)

    # Without invalidation this would still show count == 0 (stale cache).
    response = api_client.get(url)
    assert response.status_code == 200
    assert response.data["to_watch"]["count"] == 1


@pytest.mark.django_db(transaction=True)
def test_watchlist_all_reflects_watch_state_toggle(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    # total_seasons=1: the coverage gate (WatchlistView) requires
    # seasons_cached >= show.total_seasons before calling a show up_to_date —
    # without this the show could never reach up_to_date regardless of watch
    # state, since a real (unset) total_seasons of 0 never satisfies "> 0".
    show = CachedShow.objects.create(
        tmdb_id=5002, title="Toggle Show", status=CachedShow.Status.ENDED, total_seasons=1
    )
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=50021,
        air_date="2026-01-01", runtime_minutes=20,
    )
    Watchlist.objects.create(user=user, show=show)

    url = reverse("watchlist") + "?page_size=all"
    response = api_client.get(url)
    assert response.data["to_watch"]["count"] == 1
    assert response.data["up_to_date"]["count"] == 0

    toggle_response = api_client.post(
        reverse("watch-state-toggle"), {"episode_id": episode.tmdb_id}, format="json"
    )
    assert toggle_response.status_code == 200

    response = api_client.get(url)
    assert response.data["to_watch"]["count"] == 0
    assert response.data["up_to_date"]["count"] == 1


# bulk-toggle (Cascade Catch-Up) uses WatchState.bulk_create, which Django
# never fires post_save signals for — so signals.py's own cache-bust
# receiver, wired to that signal, silently never runs for this endpoint.
# Regression coverage for the fix (views.py's watched=True branch now busts
# the cache itself after the batch, the same way run_tvtime_import works
# around the identical gap for its own bulk_create).
@pytest.mark.django_db(transaction=True)
def test_watchlist_all_reflects_bulk_toggle_cascade_catch_up(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    # total_seasons=1 — see test_watchlist_all_reflects_watch_state_toggle's
    # comment on why the coverage gate needs this set.
    show = CachedShow.objects.create(
        tmdb_id=5003, title="Cascade Show", status=CachedShow.Status.ENDED, total_seasons=1
    )
    episodes = [
        CachedEpisode.objects.create(
            show=show, season_number=1, episode_number=n, tmdb_id=50030 + n,
            air_date="2026-01-01", runtime_minutes=20,
        )
        for n in range(1, 4)
    ]
    Watchlist.objects.create(user=user, show=show)

    url = reverse("watchlist") + "?page_size=all"
    response = api_client.get(url)
    assert response.data["to_watch"]["count"] == 1

    bulk_response = api_client.post(
        reverse("watch-state-bulk-toggle"),
        {"episode_ids": [ep.tmdb_id for ep in episodes], "watched": True},
        format="json",
    )
    assert bulk_response.status_code == 200

    # Without the cache-bust fix this would still read count == 1 (stale) /
    # up_to_date == 0, since bulk_create never triggered signals.py's
    # invalidation receiver.
    response = api_client.get(url)
    assert response.data["to_watch"]["count"] == 0
    assert response.data["up_to_date"]["count"] == 1


# ── MovieWatchlistView response cache + watched_at annotation ──────────────

@pytest.mark.django_db(transaction=True)
def test_movie_watchlist_reflects_toggle_and_exposes_watched_at(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    # release_date in the past — Phase 74's release-date gate on
    # MovieWatchStateToggleView otherwise rejects the toggle below (a
    # movie with no release_date is treated as not-yet-released).
    movie = MovieCache.objects.create(
        tmdb_id=6001, title="Cache Test Movie", runtime_minutes=100, release_date="2020-01-01"
    )
    MovieWatchlist.objects.create(user=user, movie=movie)

    url = reverse("movies-watchlist")
    response = api_client.get(url)
    assert response.status_code == 200
    assert len(response.data["watch_next"]) == 1
    assert len(response.data["watched"]) == 0

    toggle_response = api_client.post(
        reverse("movies-toggle"), {"movie_id": movie.tmdb_id}, format="json"
    )
    assert toggle_response.status_code == 200

    response = api_client.get(url)
    assert len(response.data["watch_next"]) == 0
    assert len(response.data["watched"]) == 1
    assert response.data["watched"][0]["watched_at"] is not None


# ── AnalyticsMoviesView response cache bust on MovieReview (Phase 85,
#    Batch C) — average_rating/rating_distribution are derived from
#    MovieReview rows, which nothing busted the analytics cache for before
#    this fix; a rating change could sit stale for up to
#    ANALYTICS_MOVIES_CACHE_TTL_SECONDS. ──────────────────────────────────

@pytest.mark.django_db(transaction=True)
def test_analytics_movies_reflects_review_after_cache_bust(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    movie = MovieCache.objects.create(tmdb_id=6002, title="Rated Movie", runtime_minutes=100)
    MovieWatchState.objects.create(user=user, movie=movie)

    url = reverse("analytics-movies")
    response = api_client.get(url)
    assert response.status_code == 200
    assert response.data["rated_count"] == 0
    assert response.data["average_rating"] is None

    # Without invalidate_analytics_movies_cache_on_review (signals.py), this
    # would still read the primed cache above — rated_count stuck at 0.
    MovieReview.objects.create(user=user, movie=movie, rating="4.0")

    response = api_client.get(url)
    assert response.data["rated_count"] == 1
    assert response.data["average_rating"] == 4.0


# ── AnalyticsGenresView response cache (Phase 85, Batch D) ─────────────────
# Was entirely uncached — profiled against production at ~2.1s on every
# call for a real large library (see PROJECT_STATUS.md's Batch D entry).

@pytest.mark.django_db(transaction=True)
def test_analytics_genres_reflects_new_watch_after_cache_bust(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(
        tmdb_id=6003, title="Genre Cache Show", status=CachedShow.Status.ENDED, genres=["Drama"]
    )
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=60031,
        air_date="2020-01-01", runtime_minutes=30,
    )

    url = reverse("analytics-genres")
    response = api_client.get(url)
    assert response.status_code == 200
    assert response.data == []

    # Without invalidate_analytics_movies_cache_on_review's sibling bust
    # (both route through _bust_analytics_dashboard_and_statistics_cache),
    # this would still read the primed empty-list cache above.
    WatchState.objects.create(user=user, episode=episode)

    response = api_client.get(url)
    assert len(response.data) == 1
    assert response.data[0]["genre"] == "Drama"
    assert response.data[0]["episodes_watched"] == 1
