from datetime import datetime, timedelta, timezone as dt_timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import (CachedEpisode, CachedShow, MovieCache, MovieReview, MovieRewatch,
                         MovieWatchState, RewatchEpisodeState, ShowRewatch, WatchState)
from core.year_review import build_year_review


@pytest.fixture
def user(db):
    return get_user_model().objects.create_user(username="year-diary")


def show_with_episode(id=8001):
    show = CachedShow.objects.create(tmdb_id=id, title="Our series", genres=["Drama"],
                                    status="ENDED", total_seasons=1, total_episodes=1)
    episode = CachedEpisode.objects.create(tmdb_id=id * 100, show=show, season_number=1,
        episode_number=1, title="Finale", runtime_minutes=30, air_date=timezone.now().date() - timedelta(days=400))
    return show, episode


def test_year_review_combines_media_and_repeat_watches_with_separate_totals(user):
    year = timezone.now().year - 1
    watched = datetime(year, 4, 10, 12, tzinfo=dt_timezone.utc)
    show, episode = show_with_episode()
    WatchState.objects.create(user=user, episode=episode, watched_at=watched)
    round = ShowRewatch.objects.create(user=user, show=show, round_number=2)
    RewatchEpisodeState.objects.create(rewatch=round, episode=episode, watched_at=watched + timedelta(days=1))
    movie = MovieCache.objects.create(tmdb_id=9001, title="Our film", runtime_minutes=120, genres_string="Drama, Comedy")
    MovieWatchState.objects.create(user=user, movie=movie, watched_at=watched + timedelta(days=2))
    MovieRewatch.objects.create(user=user, movie=movie, watched_at=watched + timedelta(days=3))
    MovieReview.objects.create(user=user, movie=movie, rating=Decimal("4.5"))
    data = build_year_review(user, year, ZoneInfo("UTC"))
    assert data["hours_watched"] == 5
    assert data["series_hours"] == 1
    assert data["movie_hours"] == 4
    assert data["episodes_watched"] == data["movies_watched"] == 2
    assert data["first_watch_episodes"] == data["first_watch_movies"] == 1
    assert data["episode_rewatches"] == data["movie_rewatches"] == 1
    assert data["longest_streak"] == data["active_days"] == 4
    assert data["shows_finished"] == 1
    assert data["months"][3]["series_minutes"] == 60
    assert data["months"][3]["movie_minutes"] == 240
    assert data["months"][3]["top_movie"]["title"] == movie.title
    assert data["average_rating"] == 4.5
    assert data["watched_movies"][0]["rewatches"] == 1
    assert data["top_genres"][0] == {"genre": "Drama", "count": 4}


def test_movie_only_year_has_a_recap_and_previous_year_is_not_counted(user):
    year = timezone.now().year - 1
    movie = MovieCache.objects.create(tmdb_id=9002, title="Movie only", runtime_minutes=0)
    MovieWatchState.objects.create(user=user, movie=movie, watched_at=datetime(year, 6, 1, tzinfo=dt_timezone.utc))
    show, episode = show_with_episode()
    WatchState.objects.create(user=user, episode=episode, watched_at=datetime(year - 1, 5, 1, tzinfo=dt_timezone.utc))
    data = build_year_review(user, year, ZoneInfo("UTC"))
    assert data["movies_watched"] == 1
    assert data["episodes_watched"] == data["shows_finished"] == 0
    assert data["unknown_runtime_watches"] == 1
    assert data["biggest_month"] == "June"
    assert data["most_watched_show"] is None
    assert year - 1 in data["available_years"]


def test_local_year_boundary_future_events_and_account_isolation(user):
    year = timezone.now().year - 1
    _, episode = show_with_episode()
    WatchState.objects.create(user=user, episode=episode, watched_at=datetime(year - 1, 12, 31, 20, tzinfo=dt_timezone.utc))
    movie = MovieCache.objects.create(tmdb_id=9003, title="Future", runtime_minutes=90)
    MovieWatchState.objects.create(user=user, movie=movie, watched_at=timezone.now() + timedelta(days=10))
    other = get_user_model().objects.create_user(username="other-diary")
    MovieWatchState.objects.create(user=other, movie=movie, watched_at=datetime(year, 2, 2, tzinfo=dt_timezone.utc))
    data = build_year_review(user, year, ZoneInfo("Asia/Kolkata"))
    assert data["episodes_watched"] == 1
    assert data["watched_shows"][0]["first_watched"] == f"{year}-01-01"
    assert data["movies_watched"] == 0
    assert data["longest_streak"] == 1
    assert build_year_review(user, year, ZoneInfo("UTC"))["episodes_watched"] == 0


def test_incomplete_cache_does_not_claim_a_finished_series(user):
    year = timezone.now().year - 1
    show, episode = show_with_episode()
    show.total_seasons = 2
    show.total_episodes = 12
    show.save()
    WatchState.objects.create(user=user, episode=episode, watched_at=datetime(year, 2, 2, tzinfo=dt_timezone.utc))
    assert build_year_review(user, year, ZoneInfo("UTC"))["shows_finished"] == 0


def test_year_review_api_serializes_new_fields_and_validates_inputs(user):
    client = APIClient()
    client.force_authenticate(user)
    response = client.get(reverse("analytics-year-review"), {"year": timezone.now().year, "timezone": "Asia/Kolkata"})
    assert response.status_code == 200
    assert response.data["movies_watched"] == response.data["active_days"] == 0
    assert len(response.data["months"]) == 12
    assert response.data["timezone"] == "Asia/Kolkata"
    for params in [{"year": "oops"}, {"year": 9999}, {"timezone": "bad/zone"}]:
        assert client.get(reverse("analytics-year-review"), params).status_code == 400
    assert APIClient().get(reverse("analytics-year-review")).status_code == 401


def test_year_review_query_count_does_not_grow_per_title(user, django_assert_max_num_queries):
    year = timezone.now().year - 1
    for id in range(9100, 9112):
        movie = MovieCache.objects.create(tmdb_id=id, title=f"Movie {id}", runtime_minutes=90)
        MovieWatchState.objects.create(user=user, movie=movie, watched_at=datetime(year, 6, 1, tzinfo=dt_timezone.utc))
    with django_assert_max_num_queries(15):
        data = build_year_review(user, year, ZoneInfo("UTC"))
    assert len(data["watched_movies"]) == 12
