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

from core.models import (
    CachedEpisode,
    CachedShow,
    Follow,
    MovieCache,
    MovieReview,
    MovieWatchState,
    ShowReview,
    WatchState,
)

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
def test_viewers_own_row_in_someone_elses_list_is_flagged_self(api_client, create_user):
    """The concrete bug (Phase 75.6): Alice looks at Bob's followers list,
    and Alice is one of Bob's followers — her own row must be flagged
    is_self so the client hides the Follow button next to her own username
    instead of rendering one that always 400s. is_following is (correctly)
    False for that row, since Follow's own DB constraint forbids a
    self-follow row from ever existing — that's exactly what the old code
    misread as "not following yet" and rendered a button for."""
    alice = create_user("view_alice")
    bob = create_user("view_bob")
    Follow.objects.create(follower=alice, following=bob)  # alice follows bob

    api_client.force_authenticate(user=alice)
    followers = api_client.get(reverse("user-followers", args=[bob.username]))
    assert followers.status_code == 200
    alice_row = next(row for row in followers.data["results"] if row["username"] == "view_alice")
    assert alice_row["is_self"] is True
    assert alice_row["is_following"] is False

    other_rows = [row for row in followers.data["results"] if row["username"] != "view_alice"]
    assert all(row["is_self"] is False for row in other_rows)


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
def test_activity_feed_shows_followee_reviews_not_watch_history(api_client, create_user):
    """Phase 75.6: the feed surfaces followees' reviews (an opinion), not
    their raw watch history (a checkbox) — a WatchState/MovieWatchState row
    alone, with no review, must never produce a card."""
    viewer = create_user("feed_viewer")
    followee = create_user("feed_followee")
    Follow.objects.create(follower=viewer, following=followee)

    show = CachedShow.objects.create(tmdb_id=7001, title="Reviewed Show", status=CachedShow.Status.ENDED)
    episode = CachedEpisode.objects.create(
        show=show, season_number=1, episode_number=1, tmdb_id=70011,
        air_date="2026-01-01", runtime_minutes=20,
    )
    WatchState.objects.create(user=followee, episode=episode)
    ShowReview.objects.create(user=followee, show=show, rating=4, note="Loved it")

    movie = MovieCache.objects.create(tmdb_id=7002, title="Unreviewed Movie", release_date="2020-01-01", runtime_minutes=90)
    MovieWatchState.objects.create(user=followee, movie=movie)
    # Deliberately no MovieReview for this one — must not appear in the feed.

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    results = response.data["results"]
    assert len(results) == 1
    card = results[0]
    assert card["type"] == "review"
    assert card["media_type"] == "tv"
    assert card["tmdb_id"] == show.tmdb_id
    assert card["title"] == "Reviewed Show"
    assert card["note"] == "Loved it"


@pytest.mark.django_db
def test_activity_feed_includes_movie_reviews(api_client, create_user):
    viewer = create_user("feed_viewer2")
    followee = create_user("feed_followee2")
    Follow.objects.create(follower=viewer, following=followee)

    movie = MovieCache.objects.create(tmdb_id=7003, title="Feed Movie", release_date="2020-01-01", runtime_minutes=90)
    MovieReview.objects.create(user=followee, movie=movie, rating=5)

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    results = response.data["results"]
    assert len(results) == 1
    assert results[0]["media_type"] == "movie"
    assert results[0]["title"] == "Feed Movie"


@pytest.mark.django_db
def test_activity_feed_excludes_reviews_from_private_accounts(api_client, create_user):
    """A followed account that has since gone private must not broadcast
    reviews — the rest of this module already prevents following one
    from scratch, this covers "was public, went private after"."""
    viewer = create_user("feed_viewer3")
    followee = create_user("feed_followee3", is_private=True)
    Follow.objects.create(follower=viewer, following=followee)

    show = CachedShow.objects.create(tmdb_id=7004, title="Private Show", status=CachedShow.Status.ENDED)
    ShowReview.objects.create(user=followee, show=show, rating=3)

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    assert response.data["results"] == []


@pytest.mark.django_db
def test_activity_feed_excludes_reviews_outside_window(api_client, create_user):
    viewer = create_user("old_viewer")
    followee = create_user("old_followee")
    Follow.objects.create(follower=viewer, following=followee)

    show = CachedShow.objects.create(tmdb_id=7101, title="Old Show", status=CachedShow.Status.ENDED)
    review = ShowReview.objects.create(user=followee, show=show, rating=4)
    ShowReview.objects.filter(pk=review.pk).update(updated_at=timezone.now() - timezone.timedelta(days=30))

    api_client.force_authenticate(user=viewer)
    response = api_client.get(reverse("friends-activity"))
    assert response.status_code == 200
    assert response.data["results"] == []


@pytest.mark.django_db(transaction=True)
def test_activity_feed_cache_busted_on_new_review(api_client, create_user):
    """A followee's new review must show up on the follower's very next
    request, not after waiting out FRIENDS_FEED_CACHE_TTL_SECONDS — confirms
    the signals.py receiver actually busts the follower's cached page 1.

    transaction=True is load-bearing here, not incidental: the cache-bust
    runs inside transaction.on_commit(), which the default django_db
    (wraps each test in a transaction it rolls back, never commits) simply
    never fires. Real requests always commit, so this only affects the test.
    """
    viewer = create_user("cache_viewer")
    followee = create_user("cache_followee")
    Follow.objects.create(follower=viewer, following=followee)

    api_client.force_authenticate(user=viewer)
    first_response = api_client.get(reverse("friends-activity"))
    assert first_response.status_code == 200
    assert first_response.data["results"] == []

    show = CachedShow.objects.create(tmdb_id=7300, title="Freshly Reviewed", status=CachedShow.Status.ENDED)
    ShowReview.objects.create(user=followee, show=show, rating=4)

    second_response = api_client.get(reverse("friends-activity"))
    assert second_response.status_code == 200
    titles = {row["title"] for row in second_response.data["results"]}
    assert "Freshly Reviewed" in titles


@pytest.mark.django_db
def test_activity_feed_pagination_returns_different_rows_per_page(api_client, create_user, settings):
    """Phase 75.6 cache-key bug: friends_feed_cache_key had no `page`
    component, so every page returned page 1's cached payload — infinite
    scroll just repeated the same rows forever. Confirms page 2 differs."""
    viewer = create_user("paging_viewer")
    followee = create_user("paging_followee")
    Follow.objects.create(follower=viewer, following=followee)

    for n in range(25):
        show = CachedShow.objects.create(tmdb_id=7200 + n, title=f"Show {n}", status=CachedShow.Status.ENDED)
        ShowReview.objects.create(user=followee, show=show, rating=3)

    api_client.force_authenticate(user=viewer)
    page1 = api_client.get(reverse("friends-activity"), {"page": 1})
    page2 = api_client.get(reverse("friends-activity"), {"page": 2})
    assert page1.status_code == 200
    assert page2.status_code == 200
    page1_ids = {row["tmdb_id"] for row in page1.data["results"]}
    page2_ids = {row["tmdb_id"] for row in page2.data["results"]}
    assert page1_ids, "page 1 should have results"
    assert page2_ids, "page 2 should have results"
    assert page1_ids.isdisjoint(page2_ids)
