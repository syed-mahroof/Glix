from datetime import timedelta

import pytest
from django.urls import reverse
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient

from core.analytics_views import _intensity_for_count
from core.models import (
    CachedEpisode,
    CachedShow,
    MovieCache,
    MovieReview,
    MovieWatchlist,
    MovieWatchState,
    WatchState,
    Watchlist,
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


# ── Regression coverage for the fixed AnalyticsAchievementsView bug ────────
# _compute_badge_progress used to build a `completed_shows` queryset that
# filtered an annotated int Count() against the string literal "watched"
# (via a bogus models_aired() helper) — Postgres raises on that comparison,
# so this endpoint 500'd on every real call. The value was never even used
# afterwards. Both blocks were deleted; these tests just assert the views
# come back clean, with and without any tracked data.

@pytest.mark.django_db
def test_achievements_empty_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-achievements"))
    assert response.status_code == 200
    assert isinstance(response.data, list)
    assert len(response.data) > 0


@pytest.mark.django_db
def test_achievements_with_watch_history(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=9001, title="Test Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=90011,
        air_date="2026-01-01", runtime_minutes=42,
    )
    Watchlist.objects.get_or_create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episode)

    response = api_client.get(reverse("analytics-achievements"))
    assert response.status_code == 200


@pytest.mark.django_db
def test_dashboard_empty_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-dashboard"))
    assert response.status_code == 200
    assert response.data["total_shows_tracked"] == 0


@pytest.mark.django_db
def test_dashboard_with_completed_show(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=9002, title="Completed Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=90021,
        air_date="2026-01-01", runtime_minutes=30,
    )
    Watchlist.objects.get_or_create(user=user, show=show)
    WatchState.objects.create(user=user, episode=episode)

    response = api_client.get(reverse("analytics-dashboard"))
    assert response.status_code == 200
    assert response.data["total_shows_tracked"] == 1
    assert response.data["total_episodes_watched"] == 1


# ── Group G: fixed-threshold intensity + ?range=all full-history heatmap ──

def test_intensity_fixed_thresholds_for_heavy_watcher():
    # scale_max >= 4 uses the fixed 7+/4+/2+/1 thresholds regardless of
    # what the window's actual max was (a 17-episode binge day must not
    # flatten every 1-4 episode day to intensity 1).
    assert _intensity_for_count(0, scale_max=17) == 0
    assert _intensity_for_count(1, scale_max=17) == 1
    assert _intensity_for_count(2, scale_max=17) == 2
    assert _intensity_for_count(3, scale_max=17) == 2
    assert _intensity_for_count(4, scale_max=17) == 3
    assert _intensity_for_count(6, scale_max=17) == 3
    assert _intensity_for_count(7, scale_max=17) == 4
    assert _intensity_for_count(17, scale_max=17) == 4


def test_intensity_direct_mapping_for_light_watcher():
    # scale_max < 4 falls back to a direct 1:1 mapping so a light
    # watcher's few episodes still span the color range instead of
    # every day landing on intensity 1.
    assert _intensity_for_count(1, scale_max=2) == 1
    assert _intensity_for_count(2, scale_max=2) == 2
    assert _intensity_for_count(0, scale_max=2) == 0


@pytest.mark.django_db
def test_heatmap_all_time_empty_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-heatmap"), {"range": "all"})
    assert response.status_code == 200
    assert response.data["years"] == []


@pytest.mark.django_db
def test_heatmap_all_time_groups_by_year_with_rollups(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=9101, title="Multi-Year Show", status=CachedShow.Status.ENDED)
    now = timezone.now()

    # Two episodes watched "now" (this year) and one watched ~400 days ago
    # (a different year), so the payload must contain two year buckets.
    ep1 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=91011,
        air_date="2020-01-01", runtime_minutes=20,
    )
    ep2 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=2, tmdb_id=91012,
        air_date="2020-01-01", runtime_minutes=25,
    )
    ep3 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=3, tmdb_id=91013,
        air_date="2020-01-01", runtime_minutes=30,
    )
    WatchState.objects.create(user=user, episode=ep1, watched_at=now)
    WatchState.objects.create(user=user, episode=ep2, watched_at=now)
    WatchState.objects.create(user=user, episode=ep3, watched_at=now - timedelta(days=400))

    response = api_client.get(reverse("analytics-heatmap"), {"range": "all"})
    assert response.status_code == 200
    years = response.data["years"]
    assert len(years) == 2

    # Most recent year first.
    current_year_bucket = years[0]
    assert current_year_bucket["year"] == now.year
    assert current_year_bucket["episodes_watched"] == 2
    assert current_year_bucket["minutes_watched"] == 45
    assert current_year_bucket["days_active"] == 1
    assert current_year_bucket["max_episodes_in_a_day"] == 2
    assert len(current_year_bucket["days"]) == 1

    older_year_bucket = years[1]
    assert older_year_bucket["episodes_watched"] == 1


@pytest.mark.django_db
def test_heatmap_days_range_still_dense_and_unaffected_by_range_all(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-heatmap"), {"days": 7})
    assert response.status_code == 200
    assert isinstance(response.data, list)
    assert len(response.data) == 7


# ── Group H: movie_completion_pct fix + AnalyticsMoviesView ───────────────

@pytest.mark.django_db
def test_completion_view_movie_percentage_no_longer_hardcoded(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    movie_watched = MovieCache.objects.create(
        tmdb_id=8001, title="Watched Movie", release_date="2020-01-01",
        runtime_minutes=100, genres_string="Drama",
    )
    movie_unwatched = MovieCache.objects.create(
        tmdb_id=8002, title="Unwatched Movie", release_date="2021-01-01",
        runtime_minutes=90, genres_string="Comedy",
    )
    MovieWatchlist.objects.create(user=user, movie=movie_watched)
    MovieWatchlist.objects.create(user=user, movie=movie_unwatched)
    MovieWatchState.objects.create(user=user, movie=movie_watched)

    response = api_client.get(reverse("analytics-completion"))
    assert response.status_code == 200
    assert response.data["movies_watched"] == 1
    assert response.data["movies_tracked"] == 2
    assert response.data["movie_completion_pct"] == 50.0


@pytest.mark.django_db
def test_completion_view_movie_percentage_zero_when_nothing_tracked(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-completion"))
    assert response.status_code == 200
    assert response.data["movie_completion_pct"] == 0.0


@pytest.mark.django_db
def test_analytics_movies_view_empty_state(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-movies"))
    assert response.status_code == 200
    assert response.data["movies_watched"] == 0
    assert response.data["longest_movie"] is None
    assert response.data["top_genres"] == []
    assert response.data["by_decade"] == []
    assert response.data["recent_movies"] == []


@pytest.mark.django_db
def test_analytics_movies_view_aggregates_correctly(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    short_movie = MovieCache.objects.create(
        tmdb_id=8101, title="Short Film", release_date="1995-06-01",
        runtime_minutes=80, genres_string="Drama, Comedy",
    )
    long_movie = MovieCache.objects.create(
        tmdb_id=8102, title="Epic Film", release_date="2005-06-01",
        runtime_minutes=180, genres_string="Drama, Action",
    )
    MovieWatchlist.objects.create(user=user, movie=short_movie)
    MovieWatchlist.objects.create(user=user, movie=long_movie)
    MovieWatchState.objects.create(user=user, movie=short_movie)
    MovieWatchState.objects.create(user=user, movie=long_movie)

    response = api_client.get(reverse("analytics-movies"))
    assert response.status_code == 200
    data = response.data

    assert data["movies_watched"] == 2
    assert data["movies_tracked"] == 2
    assert data["completion_pct"] == 100.0
    assert data["total_runtime_minutes"] == 260
    assert data["average_runtime_minutes"] == 130.0
    assert data["longest_movie"]["tmdb_id"] == long_movie.tmdb_id
    assert data["longest_movie"]["runtime_minutes"] == 180

    genres_by_name = {g["genre"]: g["count"] for g in data["top_genres"]}
    assert genres_by_name["Drama"] == 2
    assert genres_by_name["Comedy"] == 1
    assert genres_by_name["Action"] == 1

    decades_by_name = {d["decade"]: d["count"] for d in data["by_decade"]}
    assert decades_by_name == {"1990s": 1, "2000s": 1}

    assert len(data["recent_movies"]) == 2


# ── Phase 85, Batch C: movie analytics expansion ────────────────────────────

@pytest.mark.django_db
def test_analytics_movies_view_by_language_and_shortest_movie(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    korean_movie = MovieCache.objects.create(
        tmdb_id=8301, title="Korean Film", release_date="2020-01-01",
        runtime_minutes=95, genres_string="Drama", original_language="ko",
    )
    english_movie = MovieCache.objects.create(
        tmdb_id=8302, title="English Film", release_date="2021-01-01",
        runtime_minutes=150, genres_string="Action", original_language="en",
    )
    # original_language="" — a movie cached before that field existed / not
    # yet re-synced. Must land in its own "unknown" bucket, not be dropped.
    unknown_language_movie = MovieCache.objects.create(
        tmdb_id=8303, title="Unsynced Film", release_date="2019-01-01",
        runtime_minutes=110, genres_string="Comedy", original_language="",
    )
    # runtime_minutes=0 — TMDB runtime not yet known (MovieCache's own
    # default). Must be excluded from "shortest", not spuriously win it.
    unsynced_runtime_movie = MovieCache.objects.create(
        tmdb_id=8304, title="No Runtime Yet", release_date="2018-01-01",
        runtime_minutes=0, genres_string="Horror", original_language="en",
    )
    for movie in (korean_movie, english_movie, unknown_language_movie, unsynced_runtime_movie):
        MovieWatchlist.objects.create(user=user, movie=movie)
        MovieWatchState.objects.create(user=user, movie=movie)

    response = api_client.get(reverse("analytics-movies"))
    assert response.status_code == 200
    data = response.data

    languages_by_code = {row["language"]: row["count"] for row in data["by_language"]}
    assert languages_by_code == {"ko": 1, "en": 2, "unknown": 1}

    # Shortest of {95, 150, 110} — the 0-runtime movie must not win.
    assert data["shortest_movie"]["tmdb_id"] == korean_movie.tmdb_id
    assert data["shortest_movie"]["runtime_minutes"] == 95
    assert data["longest_movie"]["tmdb_id"] == english_movie.tmdb_id


@pytest.mark.django_db
def test_analytics_movies_view_this_year_and_by_month(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    now = timezone.now()

    this_year_movie = MovieCache.objects.create(
        tmdb_id=8401, title="Watched This Year", release_date="2022-01-01", runtime_minutes=100,
    )
    last_year_movie = MovieCache.objects.create(
        tmdb_id=8402, title="Watched Last Year", release_date="2022-01-01", runtime_minutes=100,
    )
    MovieWatchState.objects.create(user=user, movie=this_year_movie, watched_at=now)
    MovieWatchState.objects.create(
        user=user, movie=last_year_movie, watched_at=now.replace(year=now.year - 1)
    )

    response = api_client.get(reverse("analytics-movies"))
    assert response.status_code == 200
    data = response.data

    # Only the current-year watch shows up in this_year_movies...
    this_year_ids = {m["tmdb_id"] for m in data["this_year_movies"]}
    assert this_year_ids == {this_year_movie.tmdb_id}

    # ...and by_month is always all 12 months, zero-filled, with the one
    # real watch landing in the current month.
    assert len(data["by_month"]) == 12
    assert [row["month"] for row in data["by_month"]] == list(range(1, 13))
    month_counts = {row["month"]: row["count"] for row in data["by_month"]}
    assert month_counts[now.month] == 1
    assert sum(month_counts.values()) == 1


@pytest.mark.django_db
def test_analytics_movies_view_rating_distribution(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    movie_a = MovieCache.objects.create(tmdb_id=8501, title="Rated A", runtime_minutes=90)
    movie_b = MovieCache.objects.create(tmdb_id=8502, title="Rated B", runtime_minutes=90)
    unrated_movie = MovieCache.objects.create(tmdb_id=8503, title="Unrated", runtime_minutes=90)
    for movie in (movie_a, movie_b, unrated_movie):
        MovieWatchState.objects.create(user=user, movie=movie)
    MovieReview.objects.create(user=user, movie=movie_a, rating="4.5")
    MovieReview.objects.create(user=user, movie=movie_b, rating="3.0")

    response = api_client.get(reverse("analytics-movies"))
    assert response.status_code == 200
    data = response.data

    assert data["rated_count"] == 2
    assert data["average_rating"] == pytest.approx(3.75)
    assert len(data["rating_distribution"]) == 10
    buckets = {str(row["rating"]): row["count"] for row in data["rating_distribution"]}
    assert buckets["4.5"] == 1
    assert buckets["3.0"] == 1
    assert buckets["0.5"] == 0


@pytest.mark.django_db
def test_analytics_movies_view_no_ratings_yet(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("analytics-movies"))
    assert response.status_code == 200
    assert response.data["rated_count"] == 0
    # Null, not 0.0 — 0.0 would read as "rated everything one star".
    assert response.data["average_rating"] is None
    assert len(response.data["rating_distribution"]) == 10
    assert all(row["count"] == 0 for row in response.data["rating_distribution"])


@pytest.mark.django_db
def test_monthly_summary_view_still_correct_after_query_collapse(api_client, create_user):
    user = create_user()
    api_client.force_authenticate(user=user)

    show = CachedShow.objects.create(tmdb_id=8201, title="Monthly Show", status=CachedShow.Status.ENDED)
    ep1 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=82011,
        air_date="2024-01-01", runtime_minutes=30,
    )
    ep2 = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=2, tmdb_id=82012,
        air_date="2024-01-01", runtime_minutes=45,
    )
    from django.utils import timezone as dj_timezone

    jan = dj_timezone.datetime(2024, 1, 15, tzinfo=dj_timezone.get_current_timezone())
    feb = dj_timezone.datetime(2024, 2, 10, tzinfo=dj_timezone.get_current_timezone())
    WatchState.objects.create(user=user, episode=ep1, watched_at=jan)
    WatchState.objects.create(user=user, episode=ep2, watched_at=feb)

    response = api_client.get(reverse("analytics-monthly-summary"), {"year": 2024})
    assert response.status_code == 200
    by_month = {row["month"]: row for row in response.data}
    assert by_month["2024-01"]["episodes_watched"] == 1
    assert by_month["2024-01"]["hours_watched"] == 0.5
    assert by_month["2024-01"]["top_show"]["title"] == "Monthly Show"
    assert by_month["2024-02"]["episodes_watched"] == 1
    assert by_month["2024-03"]["episodes_watched"] == 0
    assert by_month["2024-03"]["top_show"] is None
