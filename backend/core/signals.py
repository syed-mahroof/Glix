"""
backend/core/signals.py

Keeps derived state in sync automatically:
- Every new User gets a UserProfile row.
- Milestone badges are (re)evaluated whenever a WatchState is created,
  so achievements unlock the moment they're earned instead of needing
  a separate polling job.
- WatchStreak is updated on every new WatchState, keeping the streak
  current without a separate cron job (the Celery task is the safety net).
"""

import logging
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Count
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.utils import timezone

from core.cache_keys import (
    analytics_dashboard_cache_key,
    analytics_monthly_summary_cache_key,
    analytics_movies_cache_key,
    analytics_statistics_cache_key,
    friends_feed_cache_key,
    movie_watchlist_cache_key,
    watchlist_cache_key,
)

from core.badge_constants import (
    ANIME_GENRES,
    BADGE_ANIME_FAN,
    BADGE_BINGE_MASTER,
    BADGE_COMEDY_KING,
    BADGE_DAILY_STREAK_7,
    BADGE_DOCUMENTARY_BUFF,
    BADGE_FIRST_EPISODE,
    BADGE_FIVE_HUNDRED_EPISODES,
    BADGE_GENRE_COLLECTOR,
    BADGE_HORROR_LOVER,
    BADGE_HUNDRED_CLUB,
    BADGE_HUNDRED_SHOWS,
    BADGE_MONTHLY_STREAK_3,
    BADGE_MOVIE_LOVER,
    BADGE_SCI_FI_GURU,
    BADGE_SERIES_ADDICT,
    BADGE_TIME_TITAN,
    BADGE_THOUSAND_EPISODES,
    BADGE_WEEKEND_BINGE,
    BADGE_WEEKLY_STREAK_4,
    BINGE_MASTER_THRESHOLD,
    COMEDY_GENRES,
    DOCUMENTARY_GENRES,
    FIVE_HUNDRED_EPISODES_THRESHOLD,
    GENRE_COLLECTOR_THRESHOLD,
    GENRE_FAN_THRESHOLD,
    HORROR_GENRES,
    HUNDRED_CLUB_THRESHOLD,
    HUNDRED_SHOWS_THRESHOLD,
    MOVIE_LOVER_THRESHOLD,
    SCI_FI_GENRES,
    SERIES_ADDICT_THRESHOLD,
    TIME_TITAN_MINUTES,
    THOUSAND_EPISODES_THRESHOLD,
)
from core.models import (
    Follow,
    MovieRewatch,
    MovieReview,
    MovieWatchlist,
    MovieWatchState,
    RewatchEpisodeState,
    ShowRewatch,
    ShowReview,
    UserProfile,
    Watchlist,
    WatchState,
    WatchStreak,
)

logger = logging.getLogger(__name__)


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def create_user_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.get_or_create(user=instance)


def _update_watch_streak(user, watch_date):
    """
    Update WatchStreak for the user based on today's watch activity.
    Called inside evaluate_badges to keep it co-located with the signal.

    Streak logic:
    - If last_watch_date is yesterday → increment current_streak
    - If last_watch_date is today → no change (already counted for today)
    - Otherwise → reset current_streak to 1 (gap in the streak)
    Always: update total_streak_days if this is a new day.
    """
    streak, _ = WatchStreak.objects.get_or_create(user=user)
    today = watch_date

    if streak.last_watch_date is None:
        # First ever watch
        streak.current_streak = 1
        streak.longest_streak = 1
        streak.total_streak_days = 1
        streak.last_watch_date = today
    elif streak.last_watch_date == today:
        # Already counted today, nothing to update
        return
    elif streak.last_watch_date == today - timedelta(days=1):
        # Consecutive day — extend streak
        streak.current_streak += 1
        streak.total_streak_days += 1
        if streak.current_streak > streak.longest_streak:
            streak.longest_streak = streak.current_streak
        streak.last_watch_date = today
    else:
        # Gap — reset streak, but still count today as a watched day
        streak.total_streak_days += 1
        streak.current_streak = 1
        streak.last_watch_date = today

    streak.save(update_fields=[
        "current_streak", "longest_streak", "total_streak_days", "last_watch_date", "updated_at"
    ])


@receiver(post_save, sender=WatchState)
def evaluate_badges(sender, instance, created, **kwargs):
    if not created:
        return

    profile, _ = UserProfile.objects.get_or_create(user=instance.user)
    newly_earned = []

    # ── Episode-count badges ──────────────────────────────────────────
    if BADGE_FIRST_EPISODE not in profile.earned_badges:
        newly_earned.append(BADGE_FIRST_EPISODE)

    total_watched = WatchState.objects.filter(user=instance.user).count()

    if total_watched >= HUNDRED_CLUB_THRESHOLD and BADGE_HUNDRED_CLUB not in profile.earned_badges:
        newly_earned.append(BADGE_HUNDRED_CLUB)

    if (
        total_watched >= FIVE_HUNDRED_EPISODES_THRESHOLD
        and BADGE_FIVE_HUNDRED_EPISODES not in profile.earned_badges
    ):
        newly_earned.append(BADGE_FIVE_HUNDRED_EPISODES)

    if (
        total_watched >= THOUSAND_EPISODES_THRESHOLD
        and BADGE_THOUSAND_EPISODES not in profile.earned_badges
    ):
        newly_earned.append(BADGE_THOUSAND_EPISODES)

    # ── Binge badges ─────────────────────────────────────────────────
    show_watched = WatchState.objects.filter(
        user=instance.user, episode__show=instance.episode.show
    ).count()
    if show_watched >= BINGE_MASTER_THRESHOLD and BADGE_BINGE_MASTER not in profile.earned_badges:
        newly_earned.append(BADGE_BINGE_MASTER)

    # Series addict: 5+ shows in watchlist
    from core.models import Watchlist  # local import to avoid circular at module level
    watchlist_count = Watchlist.objects.filter(user=instance.user).count()
    if watchlist_count >= SERIES_ADDICT_THRESHOLD and BADGE_SERIES_ADDICT not in profile.earned_badges:
        newly_earned.append(BADGE_SERIES_ADDICT)

    # Weekend binge: 5+ episodes today if today is Sat/Sun
    today = timezone.now().date()
    if today.weekday() in (5, 6):  # Saturday=5, Sunday=6
        weekend_today = WatchState.objects.filter(
            user=instance.user, watched_at__date=today
        ).count()
        if weekend_today >= 5 and BADGE_WEEKEND_BINGE not in profile.earned_badges:
            newly_earned.append(BADGE_WEEKEND_BINGE)

    # ── Time badges ──────────────────────────────────────────────────
    # views.py increments total_time_watched BEFORE creating the WatchState
    # row so this check sees the post-increment total on the same request.
    if (
        profile.total_time_watched >= TIME_TITAN_MINUTES
        and BADGE_TIME_TITAN not in profile.earned_badges
    ):
        newly_earned.append(BADGE_TIME_TITAN)

    # ── Show-count milestones ────────────────────────────────────────
    if watchlist_count >= HUNDRED_SHOWS_THRESHOLD and BADGE_HUNDRED_SHOWS not in profile.earned_badges:
        newly_earned.append(BADGE_HUNDRED_SHOWS)

    # ── Genre badges ─────────────────────────────────────────────────
    # Only compute if any genre badges still unearned (avoid N+1 on every toggle)
    genre_badges_remaining = {
        BADGE_GENRE_COLLECTOR, BADGE_ANIME_FAN, BADGE_SCI_FI_GURU,
        BADGE_HORROR_LOVER, BADGE_COMEDY_KING, BADGE_DOCUMENTARY_BUFF,
    } - set(profile.earned_badges)

    if genre_badges_remaining:
        show_genre_map: dict[str, set] = {}
        genre_set: set[str] = set()

        all_watched = (
            WatchState.objects.filter(user=instance.user)
            .values("episode__show__tmdb_id", "episode__show__genres")
            .distinct()
        )
        for row in all_watched:
            sid = row["episode__show__tmdb_id"]
            for g in (row["episode__show__genres"] or []):
                genre_set.add(g)
                show_genre_map.setdefault(g, set()).add(sid)

        if len(genre_set) >= GENRE_COLLECTOR_THRESHOLD and BADGE_GENRE_COLLECTOR not in profile.earned_badges:
            newly_earned.append(BADGE_GENRE_COLLECTOR)

        def _genre_count(genre_set_target):
            return max(
                (len(show_genre_map.get(g, set())) for g in genre_set_target),
                default=0,
            )

        if _genre_count(ANIME_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_ANIME_FAN not in profile.earned_badges:
            newly_earned.append(BADGE_ANIME_FAN)
        if _genre_count(SCI_FI_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_SCI_FI_GURU not in profile.earned_badges:
            newly_earned.append(BADGE_SCI_FI_GURU)
        if _genre_count(HORROR_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_HORROR_LOVER not in profile.earned_badges:
            newly_earned.append(BADGE_HORROR_LOVER)
        if _genre_count(COMEDY_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_COMEDY_KING not in profile.earned_badges:
            newly_earned.append(BADGE_COMEDY_KING)
        if _genre_count(DOCUMENTARY_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_DOCUMENTARY_BUFF not in profile.earned_badges:
            newly_earned.append(BADGE_DOCUMENTARY_BUFF)

    # ── Streak update & streak badges ────────────────────────────────
    _update_watch_streak(instance.user, today)
    # Reload streak to check badge thresholds after update
    streak = WatchStreak.objects.get(user=instance.user)

    if streak.longest_streak >= 7 and BADGE_DAILY_STREAK_7 not in profile.earned_badges:
        newly_earned.append(BADGE_DAILY_STREAK_7)
    if streak.longest_streak >= 28 and BADGE_WEEKLY_STREAK_4 not in profile.earned_badges:
        newly_earned.append(BADGE_WEEKLY_STREAK_4)
    if streak.longest_streak >= 90 and BADGE_MONTHLY_STREAK_3 not in profile.earned_badges:
        newly_earned.append(BADGE_MONTHLY_STREAK_3)

    # ── Save if anything new was earned ──────────────────────────────
    if newly_earned:
        profile.earned_badges = [*profile.earned_badges, *newly_earned]
        profile.save(update_fields=["earned_badges"])
        logger.info("User %s earned badges: %s", instance.user.username, newly_earned)


@receiver(post_save, sender=MovieWatchState)
def evaluate_movie_badges(sender, instance, created, **kwargs):
    """
    Movie-side counterpart to evaluate_badges() above. BADGE_MOVIE_LOVER
    used to be declared in badge_constants.py/BADGE_ORDER and shown on the
    achievements screen with no code anywhere that could ever award it
    ("movies tracked separately" — true, but nothing was ever built for the
    other side). Mirrors the WatchState signal's presence-based pattern.
    """
    if not created:
        return

    profile, _ = UserProfile.objects.get_or_create(user=instance.user)
    if BADGE_MOVIE_LOVER in profile.earned_badges:
        return

    movies_watched = MovieWatchState.objects.filter(user=instance.user).count()
    if movies_watched >= MOVIE_LOVER_THRESHOLD:
        profile.earned_badges = [*profile.earned_badges, BADGE_MOVIE_LOVER]
        profile.save(update_fields=["earned_badges"])
        logger.info("User %s earned badges: ['%s']", instance.user.username, BADGE_MOVIE_LOVER)


# ── Response cache invalidation ─────────────────────────────────────────
# WatchlistView/MovieWatchlistView (core/views.py) cache their expensive
# full-fetch response per user for a short TTL (core/cache_keys.py). These
# receivers are the primary invalidation path — hooking the 4 models
# directly covers every view-layer mutation site without threading a
# manual cache.delete() through each one individually. on_commit (not a
# plain delete here) matters: busting the key before the write actually
# commits would let a concurrent GET land in that window and re-cache the
# now-stale pre-write data. The one deliberate signal-bypass in this
# codebase — tasks.py's run_tvtime_import, which uses bulk_create for
# WatchState/MovieWatchState — busts both keys explicitly itself, right
# after it calls recalculate_user_badges/recalculate_watch_streak.

def _bust_watchlist_cache(user_id):
    transaction.on_commit(lambda: cache.delete(watchlist_cache_key(user_id)))


def _bust_movie_watchlist_cache(user_id):
    transaction.on_commit(lambda: cache.delete(movie_watchlist_cache_key(user_id)))


def _bust_analytics_movies_cache(user_id):
    transaction.on_commit(lambda: cache.delete(analytics_movies_cache_key(user_id)))


def _bust_analytics_dashboard_and_statistics_cache(user_id):
    """Shared by every signal below that represents "the user watched (or
    unwatched, or rewatched) something" — AnalyticsDashboardView/
    AnalyticsStatisticsView (Phase 75.8) and the current year's monthly
    summary all derive from the same underlying WatchState/MovieWatchState/
    rewatch rows, so one bust point covers all three caches."""
    def _bust():
        cache.delete(analytics_dashboard_cache_key(user_id))
        cache.delete(analytics_statistics_cache_key(user_id))
        cache.delete(analytics_monthly_summary_cache_key(user_id, timezone.now().year))
    transaction.on_commit(_bust)


@receiver(post_save, sender=Watchlist)
@receiver(post_delete, sender=Watchlist)
def invalidate_watchlist_cache(sender, instance, **kwargs):
    _bust_watchlist_cache(instance.user_id)


@receiver(post_save, sender=WatchState)
@receiver(post_delete, sender=WatchState)
def invalidate_watchlist_cache_on_watchstate(sender, instance, **kwargs):
    _bust_watchlist_cache(instance.user_id)
    _bust_analytics_dashboard_and_statistics_cache(instance.user_id)


@receiver(post_save, sender=MovieWatchlist)
@receiver(post_delete, sender=MovieWatchlist)
def invalidate_movie_watchlist_cache(sender, instance, **kwargs):
    _bust_movie_watchlist_cache(instance.user_id)
    _bust_analytics_movies_cache(instance.user_id)


@receiver(post_save, sender=MovieWatchState)
@receiver(post_delete, sender=MovieWatchState)
def invalidate_movie_watchlist_cache_on_watchstate(sender, instance, **kwargs):
    _bust_movie_watchlist_cache(instance.user_id)
    _bust_analytics_movies_cache(instance.user_id)
    _bust_analytics_dashboard_and_statistics_cache(instance.user_id)


@receiver(post_save, sender=ShowRewatch)
@receiver(post_delete, sender=ShowRewatch)
def invalidate_analytics_cache_on_show_rewatch(sender, instance, **kwargs):
    _bust_analytics_dashboard_and_statistics_cache(instance.user_id)


@receiver(post_save, sender=RewatchEpisodeState)
@receiver(post_delete, sender=RewatchEpisodeState)
def invalidate_analytics_cache_on_rewatch_episode_state(sender, instance, **kwargs):
    _bust_analytics_dashboard_and_statistics_cache(instance.rewatch.user_id)


@receiver(post_save, sender=MovieRewatch)
@receiver(post_delete, sender=MovieRewatch)
def invalidate_analytics_cache_on_movie_rewatch(sender, instance, **kwargs):
    _bust_analytics_dashboard_and_statistics_cache(instance.user_id)


def _bust_followers_activity_feed_cache(user_id):
    """Everyone who follows `user_id` gets their activity feed's first page
    invalidated — a new/updated/deleted review from someone you follow
    should appear (or disappear) without waiting out the TTL. Only page 1:
    friends_feed_cache_key's page-aware keys mean deeper pages would need
    their own busts too, but a single review essentially never reorders
    older content that far back, and any staleness there self-heals within
    FRIENDS_FEED_CACHE_TTL_SECONDS regardless — the same tradeoff that
    module's own docstring already accepts for page 1."""
    def _bust():
        follower_ids = Follow.objects.filter(following_id=user_id).values_list("follower_id", flat=True)
        for follower_id in follower_ids:
            cache.delete(friends_feed_cache_key(follower_id, 1))
    transaction.on_commit(_bust)


@receiver(post_save, sender=ShowReview)
@receiver(post_delete, sender=ShowReview)
def invalidate_followers_feed_on_show_review(sender, instance, **kwargs):
    _bust_followers_activity_feed_cache(instance.user_id)


@receiver(post_save, sender=MovieReview)
@receiver(post_delete, sender=MovieReview)
def invalidate_followers_feed_on_movie_review(sender, instance, **kwargs):
    _bust_followers_activity_feed_cache(instance.user_id)