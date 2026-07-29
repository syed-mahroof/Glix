import pytest
from django.core.cache import cache
from django.urls import reverse
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from core.models import CachedEpisode, CachedShow, MovieCache, MovieWatchlist, Watchlist

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

    show = CachedShow.objects.create(tmdb_id=5002, title="Toggle Show", status=CachedShow.Status.ENDED)
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


# ── MovieWatchlistView response cache + watched_at annotation ──────────────

@pytest.mark.django_db(transaction=True)
def test_movie_watchlist_reflects_toggle_and_exposes_watched_at(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    movie = MovieCache.objects.create(tmdb_id=6001, title="Cache Test Movie", runtime_minutes=100)
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
