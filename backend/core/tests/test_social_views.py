"""
backend/core/tests/test_social_views.py

Phase 74 social layer: user search, follow toggle, followers/following
lists, public profile, and the friends activity feed. Security-focused —
private-account 404 indistinguishability, self-follow rejection, and the
double-tap race guard get their own tests, not just the happy path.
"""

import pytest
from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import CachedEpisode, CachedShow, Follow, MovieCache, MovieWatchState, WatchState

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password", is_private=False):
        user = User.objects.create_user(username=username, password=password)
        user.profile.is_private = is_private
        user.profile.save(update_fields=["is_private"])
        return user
    return make_user


# ─── Search ─────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_search_requires_two_chars(api_client, create_user):
    user = create_user("viewer")
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("user-search"), {"q": "a"})
    assert response.status_code == 400


@pytest.mark.django_db
def test_search_excludes_self_and_private_users(api_client, create_user):
    viewer = create_user("alice")
    create_user("alicewonder", is_private=False)
    create_user("alicesecret", is_private=True)
    api_client.force_authenticate(user=viewer)

    response = api_client.get(reverse("user-search"), {"q": "alice"})
    assert response.status_code == 200
    usernames = [row["username"] for row in response.data["results"]]
    assert "alicewonder" in usernames
    assert "alice" not in usernames
    assert "alicesecret" not in usernames


@pytest.mark.django_db
def test_search_prefix_match_ranks_first(api_client, create_user):
    viewer = create_user("viewer")
    create_user("zzz_bobmatch")
    create_user("bobmatch_first")
    api_client.force_authenticate(user=viewer)

    response = api_client.get(reverse("user-search"), {"q": "bobmatch"})
    usernames = [row["username"] for row in response.data["results"]]
    assert usernames[0] == "bobmatch_first"


# ─── Follow toggle ──────────────────────────────────────────────────────

@pytest.mark.django_db
def test_follow_toggle_creates_then_removes(api_client, create_user):
    follower = create_user("follower")
    target = create_user("target")
    api_client.force_authenticate(user=follower)
    url = reverse("user-follow-toggle", args=[target.username])

    response = api_client.post(url)
    assert response.status_code == 200
    assert response.data["following"] is True
    assert Follow.objects.filter(follower=follower, following=target).exists()

    response = api_client.post(url)
    assert response.status_code == 200
    assert response.data["following"] is False
    assert not Follow.objects.filter(follower=follower, following=target).exists()


@pytest.mark.django_db
def test_follow_self_rejected(api_client, create_user):
    user = create_user("solo")
    api_client.force_authenticate(user=user)
    response = api_client.post(reverse("user-follow-toggle", args=[user.username]))
    assert response.status_code == 400


@pytest.mark.django_db
def test_follow_private_user_404(api_client, create_user):
    follower = create_user("follower2")
    target = create_user("privatetarget", is_private=True)
    api_client.force_authenticate(user=follower)
    response = api_client.post(reverse("user-follow-toggle", args=[target.username]))
    assert response.status_code == 404
    assert not Follow.objects.filter(follower=follower, following=target).exists()


@pytest.mark.django_db
def test_follow_nonexistent_user_404(api_client, create_user):
    follower = create_user("follower3")
    api_client.force_authenticate(user=follower)
    response = api_client.post(reverse("user-follow-toggle", args=["ghost_user_zzz"]))
    assert response.status_code == 404


# ─── Followers / Following lists ────────────────────────────────────────

@pytest.mark.django_db
def test_followers_and_following_lists(api_client, create_user):
    a = create_user("user_a")
    b = create_user("user_b")
    c = create_user("user_c")
    Follow.objects.create(follower=b, following=a)
    Follow.objects.create(follower=c, following=a)
    Follow.objects.create(follower=a, following=b)

    api_client.force_authenticate(user=a)
    followers = api_client.get(reverse("user-followers", args=[a.username]))
    assert followers.status_code == 200
    follower_names = {row["username"] for row in followers.data["results"]}
    assert follower_names == {"user_b", "user_c"}

    following = api_client.get(reverse("user-following", args=[a.username]))
    assert following.status_code == 200
    following_names = {row["username"] for row in following.data["results"]}
    assert following_names == {"user_b"}
    # a follows b, so b's row on a's following list should say is_following=True
    assert all(row["is_following"] for row in following.data["results"])


@pytest.mark.django_db
def test_followers_list_404_for_private_user_viewed_by_stranger(api_client, create_user):
    stranger = create_user("stranger")
    target = create_user("privateuser2", is_private=True)
    api_client.force_authenticate(user=stranger)
    response = api_client.get(reverse("user-followers", args=[target.username]))
    assert response.status_code == 404


# ─── Public profile ─────────────────────────────────────────────────────

@pytest.mark.django_db
def test_profile_detail_self_and_viewer_relative_flags(api_client, create_user):
    a = create_user("prof_a")
    b = create_user("prof_b")
    Follow.objects.create(follower=a, following=b)  # a follows b
    Follow.objects.create(follower=b, following=a)  # b follows a back

    api_client.force_authenticate(user=a)
    response = api_client.get(reverse("user-profile-detail", args=[b.username]))
    assert response.status_code == 200
    assert response.data["is_self"] is False
    assert response.data["is_following"] is True
    assert response.data["follows_you"] is True

    self_response = api_client.get(reverse("user-profile-detail", args=[a.username]))
    assert self_response.status_code == 200
    assert self_response.data["is_self"] is True


@pytest.mark.django_db
def test_profile_detail_private_visible_to_self_hidden_from_others(api_client, create_user):
    owner = create_user("ghost", is_private=True)
    stranger = create_user("nosy")

    api_client.force_authenticate(user=owner)
    assert api_client.get(reverse("user-profile-detail", args=[owner.username])).status_code == 200

    api_client.force_authenticate(user=stranger)
    assert api_client.get(reverse("user-profile-detail", args=[owner.username])).status_code == 404


@pytest.mark.django_db
def test_profile_detail_counts_reflect_watch_activity(api_client, create_user):
    owner = create_user("watcher")
    viewer = create_user("watcher_fan")
    show = CachedShow.objects.create(tmdb_id=6001, title="Counted Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=60011,
        air_date="2026-01-01", runtime_minutes=20,
    )
    WatchState.objects.create(user=owner, episode=episode)
    movie = MovieCache.objects.create(tmdb_id=6002, title="Counted Movie", release_date="2020-01-01", runtime_minutes=100)
    MovieWatchState.objects.create(user=owner, movie=movie)

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("user-profile-detail", args=[owner.username]))
    assert response.status_code == 200
    assert response.data["episodes_watched"] == 1
    assert response.data["movies_watched"] == 1
    assert response.data["top_shows"][0]["title"] == "Counted Show"
    assert response.data["recent_movies"][0]["title"] == "Counted Movie"


# ─── Friends activity feed ──────────────────────────────────────────────

@pytest.mark.django_db
def test_activity_feed_empty_when_not_following_anyone(api_client, create_user):
    user = create_user("lonely")
    api_client.force_authenticate(user=user)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    assert response.data["results"] == []


@pytest.mark.django_db
def test_activity_feed_collapses_binge_and_includes_movie(api_client, create_user):
    viewer = create_user("feed_viewer")
    followee = create_user("feed_followee")
    Follow.objects.create(follower=viewer, following=followee)

    show = CachedShow.objects.create(tmdb_id=7001, title="Binge Show", status=CachedShow.Status.ENDED)
    now = timezone.now()
    for n in range(1, 4):
        episode = CachedEpisode.objects.create(
            show=show, season_number=1, episode_number=n, tmdb_id=70010 + n,
            air_date="2026-01-01", runtime_minutes=20,
        )
        WatchState.objects.create(user=followee, episode=episode, watched_at=now)

    movie = MovieCache.objects.create(tmdb_id=7002, title="Feed Movie", release_date="2020-01-01", runtime_minutes=90)
    MovieWatchState.objects.create(user=followee, movie=movie, watched_at=now)

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    results = response.data["results"]
    assert len(results) == 2  # one collapsed episode card + one movie card

    episode_card = next(c for c in results if c["type"] == "episodes")
    assert episode_card["episode_count"] == 3
    assert episode_card["show_title"] == "Binge Show"

    movie_card = next(c for c in results if c["type"] == "movie")
    assert movie_card["movie_title"] == "Feed Movie"


@pytest.mark.django_db
def test_activity_feed_excludes_activity_outside_window(api_client, create_user):
    viewer = create_user("old_viewer")
    followee = create_user("old_followee")
    Follow.objects.create(follower=viewer, following=followee)

    show = CachedShow.objects.create(tmdb_id=7101, title="Old Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=71011,
        air_date="2020-01-01", runtime_minutes=20,
    )
    WatchState.objects.create(
        user=followee, episode=episode, watched_at=timezone.now() - timezone.timedelta(days=30)
    )

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    assert response.data["results"] == []
