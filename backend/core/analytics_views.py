"""
backend/core/analytics_views.py

All analytics APIViews. Every view:
  - Requires IsAuthenticated (default from REST_FRAMEWORK settings).
  - Computes results from existing WatchState, Watchlist, UserProfile,
    EpisodeInteraction, CachedShow, and CachedEpisode rows — no new
    data is written by any GET here.
  - Returns pre-serialized Response objects so the mobile client never
    has to recompute derived stats like completion percentages.

Query strategy: prefer a small number of annotated aggregations over
Python-side loops; fall back to Python only when the logic is too
complex to express cleanly in ORM annotations (e.g. streak calculation
from a date sequence).
"""

import calendar
from collections import Counter, defaultdict
from datetime import date, timedelta

from django.core.cache import cache
from django.db.models import Avg, Count, Min, Sum
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.analytics_serializers import (
    AchievementItemSerializer,
    ActorStatSerializer,
    AnalyticsMoviesSerializer,
    CompletionSerializer,
    DashboardSerializer,
    GenreStatSerializer,
    HeatmapAllTimeSerializer,
    HeatmapDaySerializer,
    MonthlySummaryItemSerializer,
    StatisticsSerializer,
    StreakSerializer,
    YearReviewSerializer,
)
from core.cache_keys import (
    ANALYTICS_DASHBOARD_CACHE_TTL_SECONDS,
    ANALYTICS_HEATMAP_ALL_CACHE_TTL_SECONDS,
    ANALYTICS_MONTHLY_SUMMARY_CACHE_TTL_SECONDS,
    ANALYTICS_MOVIES_CACHE_TTL_SECONDS,
    ANALYTICS_STATISTICS_CACHE_TTL_SECONDS,
    analytics_dashboard_cache_key,
    analytics_heatmap_all_cache_key,
    analytics_monthly_summary_cache_key,
    analytics_movies_cache_key,
    analytics_statistics_cache_key,
)
from core.badge_constants import (
    BADGE_DISPLAY,
    BADGE_ORDER,
    BINGE_MASTER_THRESHOLD,
    FIVE_HUNDRED_EPISODES_THRESHOLD,
    FIVE_HUNDRED_HOURS_MINUTES,
    GENRE_COLLECTOR_THRESHOLD,
    GENRE_FAN_THRESHOLD,
    HUNDRED_CLUB_THRESHOLD,
    HUNDRED_SHOWS_THRESHOLD,
    MOVIE_LOVER_THRESHOLD,
    SERIES_ADDICT_THRESHOLD,
    THOUSAND_EPISODES_THRESHOLD,
    THOUSAND_HOURS_MINUTES,
    TIME_TITAN_MINUTES,
    ANIME_GENRES,
    SCI_FI_GENRES,
    HORROR_GENRES,
    COMEDY_GENRES,
    DOCUMENTARY_GENRES,
)
from core.models import (
    CachedEpisode,
    EpisodeInteraction,
    MovieCache,
    MovieRewatch,
    MovieWatchlist,
    MovieWatchState,
    RewatchEpisodeState,
    UserProfile,
    Watchlist,
    WatchState,
    WatchStreak,
)


# ─── Helpers ──────────────────────────────────────────────────────────────

def _get_profile(user) -> UserProfile:
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return profile


def _get_streak(user) -> WatchStreak:
    streak, _ = WatchStreak.objects.get_or_create(user=user)
    return streak


def _intensity_for_count(eps: int, scale_max: int) -> int:
    """
    Maps a day's episode count to a 0-4 heat level for the cell colour.

    Fixed thresholds (7+/4+/2+/1), not "quartile of the window's max" —
    over a multi-year window a single 17-episode binge used to flatten
    every ordinary 1-4 episode day down to intensity 1, which made the
    heatmap useless at that scale. For a light watcher whose own max in
    the window never reaches 4, fixed thresholds would flatten
    everything to intensity 1 for the opposite reason, so scale_max<4
    falls back to a direct 1:1 mapping instead (their few episodes still
    span the color range).

    Shared by every caller of _heatmap_for_user/_heatmap_all_time_for_user
    — the 365-day heatmap, the sparse ?range=all payload, and
    AnalyticsStreakView's 30-day mini-strip all change together.
    Deliberate: the old scheme was wrong on all three for the same
    reason, not just for whichever one this was written for.
    """
    if eps <= 0:
        return 0
    if scale_max < 4:
        return min(eps, 4)
    if eps >= 7:
        return 4
    if eps >= 4:
        return 3
    if eps >= 2:
        return 2
    return 1


def _rewatch_period_counts(user, start_date, group_fields: list[str]) -> dict[tuple, dict]:
    """
    Rewatch counterpart of the `.values(*group_fields).annotate(...)`
    pattern every WatchState query in this file uses — same grouping
    fields (e.g. `["watched_at__year", "watched_at__week"]`), summed
    across BOTH rewatch sources (RewatchEpisodeState ticks + MovieRewatch
    entries). Callers merge the result into their own WatchState-derived
    period map so a rewatch shows up in "how much did I watch" activity
    views (heatmap, daily/weekly/monthly/yearly stats) — see ShowRewatch's
    model docstring for why this must never touch a WatchState-derived
    *count* (lifetime episodes_watched, badges, streak) instead.

    Returns a dict keyed by the tuple of group values, in `group_fields`
    order — e.g. `{(2026, 3): {"episodes_watched": 2, "minutes_watched": 40}}`.
    """
    merged: dict[tuple, dict] = {}

    def _accumulate(rows):
        for row in rows:
            key = tuple(row[f] for f in group_fields)
            bucket = merged.setdefault(key, {"episodes_watched": 0, "minutes_watched": 0})
            bucket["episodes_watched"] += row["episodes_watched"]
            bucket["minutes_watched"] += row["minutes_watched"] or 0

    _accumulate(
        RewatchEpisodeState.objects.filter(rewatch__user=user, watched_at__date__gte=start_date)
        .values(*group_fields)
        .annotate(episodes_watched=Count("id"), minutes_watched=Sum("episode__runtime_minutes"))
    )
    _accumulate(
        MovieRewatch.objects.filter(user=user, watched_at__date__gte=start_date)
        .values(*group_fields)
        .annotate(episodes_watched=Count("id"), minutes_watched=Sum("movie__runtime_minutes"))
    )
    return merged


def _heatmap_for_user(user, days: int = 365) -> list[dict]:
    """
    Build a heatmap of watch activity over the past `days` calendar days.
    Returns a list of dicts: {date, episodes_watched, minutes_watched, intensity}.
    """
    end_date = timezone.now().date()
    start_date = end_date - timedelta(days=days - 1)

    # Single query: group WatchState rows by date, annotating episode count
    # and summed runtime.
    qs = (
        WatchState.objects.filter(user=user, watched_at__date__gte=start_date)
        .values("watched_at__date")
        .annotate(
            episodes_watched=Count("id"),
            minutes_watched=Sum("episode__runtime_minutes"),
        )
    )

    activity_by_date: dict[date, dict] = {
        row["watched_at__date"]: {
            "episodes_watched": row["episodes_watched"],
            "minutes_watched": row["minutes_watched"] or 0,
        }
        for row in qs
    }

    # Rewatch activity counts toward "how much did I watch" here — see
    # _rewatch_period_counts's own docstring for why this is safe to merge
    # into a date-keyed activity map but never into a WatchState-derived count.
    for (day,), extra in _rewatch_period_counts(user, start_date, ["watched_at__date"]).items():
        bucket = activity_by_date.setdefault(day, {"episodes_watched": 0, "minutes_watched": 0})
        bucket["episodes_watched"] += extra["episodes_watched"]
        bucket["minutes_watched"] += extra["minutes_watched"]

    scale_max = max((v["episodes_watched"] for v in activity_by_date.values()), default=0)

    result = []
    current = start_date
    while current <= end_date:
        data = activity_by_date.get(current)
        eps = data["episodes_watched"] if data else 0
        result.append(
            {
                "date": current,
                "episodes_watched": eps,
                "minutes_watched": data["minutes_watched"] if data else 0,
                "intensity": _intensity_for_count(eps, scale_max),
            }
        )
        current += timedelta(days=1)

    return result


# Defensive cap on how far back ?range=all will look — not an expected
# case (no user has 15 years of history yet), just a bound on worst-case
# query/response size if watched_at were ever corrupted with a bogus date.
HEATMAP_ALL_TIME_MAX_YEARS_BACK = 15


def _heatmap_all_time_for_user(user) -> dict:
    """
    Sparse, year-grouped watch-activity payload for the full-history view
    (?range=all on AnalyticsHeatmapView). Unlike _heatmap_for_user's dense
    day-by-day fill, only days with actual activity are included, plus a
    per-year rollup — a 10-year dense fill would be ~3,650 objects; sparse
    is the user's real count of active days.

    Intensity is normalized across the *entire* window, not per-year:
    per-year normalization is the intuitive fix but is wrong — it would
    destroy the year-to-year comparability that is the whole point of a
    multi-year view (a light year and a heavy year would both render as
    "fully lit up").
    """
    earliest = WatchState.objects.filter(user=user).aggregate(Min("watched_at"))["watched_at__min"]
    if earliest is None:
        return {"years": []}

    end_date = timezone.now().date()
    start_date = earliest.date()
    earliest_allowed = end_date.replace(year=end_date.year - HEATMAP_ALL_TIME_MAX_YEARS_BACK)
    if start_date < earliest_allowed:
        start_date = earliest_allowed

    qs = (
        WatchState.objects.filter(user=user, watched_at__date__gte=start_date)
        .values("watched_at__date")
        .annotate(
            episodes_watched=Count("id"),
            minutes_watched=Sum("episode__runtime_minutes"),
        )
    )

    activity_by_date: dict[date, dict] = {
        row["watched_at__date"]: {
            "episodes_watched": row["episodes_watched"],
            "minutes_watched": row["minutes_watched"] or 0,
        }
        for row in qs
    }

    # See _heatmap_for_user's identical merge for why this is safe.
    for (day,), extra in _rewatch_period_counts(user, start_date, ["watched_at__date"]).items():
        bucket = activity_by_date.setdefault(day, {"episodes_watched": 0, "minutes_watched": 0})
        bucket["episodes_watched"] += extra["episodes_watched"]
        bucket["minutes_watched"] += extra["minutes_watched"]

    scale_max = max((v["episodes_watched"] for v in activity_by_date.values()), default=0)

    years: dict[int, dict] = {}
    for day, data in sorted(activity_by_date.items()):
        eps = data["episodes_watched"]
        bucket = years.setdefault(
            day.year,
            {
                "year": day.year,
                "episodes_watched": 0,
                "minutes_watched": 0,
                "days_active": 0,
                "max_episodes_in_a_day": 0,
                "days": [],
            },
        )
        bucket["episodes_watched"] += eps
        bucket["minutes_watched"] += data["minutes_watched"]
        bucket["days_active"] += 1
        bucket["max_episodes_in_a_day"] = max(bucket["max_episodes_in_a_day"], eps)
        bucket["days"].append(
            {
                "date": day,
                "episodes_watched": eps,
                "minutes_watched": data["minutes_watched"],
                "intensity": _intensity_for_count(eps, scale_max),
            }
        )

    return {"years": [years[y] for y in sorted(years.keys(), reverse=True)]}


def _genre_stats(user) -> list[dict]:
    """
    Compute per-genre episode-watch counts by joining WatchState → CachedEpisode
    → CachedShow.genres (an ArrayField). Each watched episode contributes its
    show's genres to the tally.
    """
    watched_shows = (
        WatchState.objects.filter(user=user)
        .values("episode__show__genres", "episode__show__tmdb_id")
        .distinct()
        .order_by()
    )

    # For unique shows, tally genres
    genre_episode_counts: Counter = Counter()
    genre_show_sets: dict[str, set] = defaultdict(set)

    qs = (
        WatchState.objects.filter(user=user)
        .select_related("episode__show")
        .order_by()
    )
    for ws in qs:
        for genre in (ws.episode.show.genres or []):
            genre_episode_counts[genre] += 1
            genre_show_sets[genre].add(ws.episode.show.tmdb_id)

    total_eps = sum(genre_episode_counts.values()) or 1
    result = []
    for genre, count in genre_episode_counts.most_common(10):
        result.append(
            {
                "genre": genre,
                "episodes_watched": count,
                "shows_watched": len(genre_show_sets[genre]),
                "percentage": round((count / total_eps) * 100, 1),
            }
        )
    return result


def _compute_badge_progress(user, profile: UserProfile, streak: WatchStreak) -> list[dict]:
    """
    Return ordered list of achievement dicts with progress info for all
    known badges.
    """
    earned_set = set(profile.earned_badges)

    # Counts needed for progress computation
    total_watched = WatchState.objects.filter(user=user).count()
    total_minutes = profile.total_time_watched

    watchlist_count = Watchlist.objects.filter(user=user).count()
    movies_watched = MovieWatchState.objects.filter(user=user).count()

    # Genre-based: unique genres across watched shows
    genre_set: set[str] = set()
    show_genre_map: dict[str, set] = defaultdict(set)
    for ws in WatchState.objects.filter(user=user).select_related("episode__show").order_by():
        for g in (ws.episode.show.genres or []):
            genre_set.add(g)
            show_genre_map[g].add(ws.episode.show.tmdb_id)

    distinct_genres = len(genre_set)

    # Per-show episode counts for binge badge
    per_show = (
        WatchState.objects.filter(user=user)
        .values("episode__show_id")
        .annotate(c=Count("id"))
    )
    max_per_show = max((r["c"] for r in per_show), default=0)

    def _pct(val, threshold):
        return min(1.0, round(val / threshold, 3)) if threshold else 0.0

    # Weekend binge: any Sat/Sun with 5+ episodes
    weekend_max = 0
    weekend_qs = (
        WatchState.objects.filter(user=user)
        .values("watched_at__date")
        .annotate(c=Count("id"))
    )
    for row in weekend_qs:
        d = row["watched_at__date"]
        if d and d.weekday() in (5, 6) and row["c"] >= 5:
            weekend_max = max(weekend_max, row["c"])

    results = []
    for slug in BADGE_ORDER:
        meta = BADGE_DISPLAY.get(slug, {})
        is_earned = slug in earned_set

        # Compute progress fraction and label
        if slug in ("first_episode",):
            prog = 1.0 if total_watched > 0 else 0.0
            prog_label = f"{min(total_watched, 1)} / 1 episode"
        elif slug == "hundred_club":
            prog = _pct(total_watched, HUNDRED_CLUB_THRESHOLD)
            prog_label = f"{total_watched} / {HUNDRED_CLUB_THRESHOLD} episodes"
        elif slug == "five_hundred_episodes":
            prog = _pct(total_watched, FIVE_HUNDRED_EPISODES_THRESHOLD)
            prog_label = f"{total_watched} / {FIVE_HUNDRED_EPISODES_THRESHOLD} episodes"
        elif slug == "thousand_episodes":
            prog = _pct(total_watched, THOUSAND_EPISODES_THRESHOLD)
            prog_label = f"{total_watched} / {THOUSAND_EPISODES_THRESHOLD} episodes"
        elif slug == "binge_master":
            prog = _pct(max_per_show, BINGE_MASTER_THRESHOLD)
            prog_label = f"{max_per_show} / {BINGE_MASTER_THRESHOLD} eps on one show"
        elif slug == "time_titan":
            prog = _pct(total_minutes, TIME_TITAN_MINUTES)
            prog_label = f"{round(total_minutes/60, 1)} / {round(TIME_TITAN_MINUTES/60, 0):.0f} hours"
        elif slug == "hundred_hours":
            prog = _pct(total_minutes, TIME_TITAN_MINUTES)
            prog_label = f"{round(total_minutes/60, 1)} / {round(TIME_TITAN_MINUTES/60, 0):.0f} hours"
        elif slug == "five_hundred_hours":
            prog = _pct(total_minutes, FIVE_HUNDRED_HOURS_MINUTES)
            prog_label = f"{round(total_minutes/60, 1)} / {round(FIVE_HUNDRED_HOURS_MINUTES/60, 0):.0f} hours"
        elif slug == "thousand_hours":
            prog = _pct(total_minutes, THOUSAND_HOURS_MINUTES)
            prog_label = f"{round(total_minutes/60, 1)} / {round(THOUSAND_HOURS_MINUTES/60, 0):.0f} hours"
        elif slug == "daily_streak_7":
            prog = _pct(streak.longest_streak, 7)
            prog_label = f"{streak.longest_streak} / 7 days"
        elif slug == "weekly_streak_4":
            prog = _pct(streak.longest_streak, 28)
            prog_label = f"{streak.longest_streak} / 28 days"
        elif slug == "monthly_streak_3":
            prog = _pct(streak.longest_streak, 90)
            prog_label = f"{streak.longest_streak} / 90 days"
        elif slug == "weekend_binge":
            prog = 1.0 if weekend_max >= 5 else _pct(weekend_max, 5)
            prog_label = f"{weekend_max} / 5 weekend episodes"
        elif slug == "series_addict":
            prog = _pct(watchlist_count, SERIES_ADDICT_THRESHOLD)
            prog_label = f"{watchlist_count} / {SERIES_ADDICT_THRESHOLD} shows"
        elif slug == "genre_collector":
            prog = _pct(distinct_genres, GENRE_COLLECTOR_THRESHOLD)
            prog_label = f"{distinct_genres} / {GENRE_COLLECTOR_THRESHOLD} genres"
        elif slug == "anime_fan":
            anim_shows = len(show_genre_map.get("Animation", set()))
            prog = _pct(anim_shows, GENRE_FAN_THRESHOLD)
            prog_label = f"{anim_shows} / {GENRE_FAN_THRESHOLD} animated shows"
        elif slug == "sci_fi_guru":
            sf_shows = max(
                len(show_genre_map.get(g, set())) for g in SCI_FI_GENRES
            )
            prog = _pct(sf_shows, GENRE_FAN_THRESHOLD)
            prog_label = f"{sf_shows} / {GENRE_FAN_THRESHOLD} sci-fi shows"
        elif slug == "horror_lover":
            h_shows = len(show_genre_map.get("Horror", set()))
            prog = _pct(h_shows, GENRE_FAN_THRESHOLD)
            prog_label = f"{h_shows} / {GENRE_FAN_THRESHOLD} horror shows"
        elif slug == "comedy_king":
            c_shows = len(show_genre_map.get("Comedy", set()))
            prog = _pct(c_shows, GENRE_FAN_THRESHOLD)
            prog_label = f"{c_shows} / {GENRE_FAN_THRESHOLD} comedy shows"
        elif slug == "documentary_buff":
            d_shows = len(show_genre_map.get("Documentary", set()))
            prog = _pct(d_shows, GENRE_FAN_THRESHOLD)
            prog_label = f"{d_shows} / {GENRE_FAN_THRESHOLD} documentaries"
        elif slug == "hundred_shows":
            prog = _pct(watchlist_count, HUNDRED_SHOWS_THRESHOLD)
            prog_label = f"{watchlist_count} / {HUNDRED_SHOWS_THRESHOLD} shows"
        elif slug == "movie_lover":
            prog = _pct(movies_watched, MOVIE_LOVER_THRESHOLD)
            prog_label = f"{movies_watched} / {MOVIE_LOVER_THRESHOLD} movies"
        else:
            prog = 1.0 if is_earned else 0.0
            prog_label = "Unlocked" if is_earned else "Not yet unlocked"

        if is_earned:
            prog = 1.0

        results.append(
            {
                "slug": slug,
                "label": meta.get("label", slug),
                "description": meta.get("description", ""),
                "icon": meta.get("icon", "Award"),
                "category": meta.get("category", "milestone"),
                "earned": is_earned,
                "progress": prog,
                "progress_label": prog_label,
            }
        )

    return results


# ─── Views ────────────────────────────────────────────────────────────────

class AnalyticsDashboardView(APIView):
    """
    GET /api/analytics/dashboard/

    Cached 300s (Phase 75.8) — this does several grouped aggregate queries
    on every Profile Hub / Analytics tab focus, previously uncached.
    Invalidated by signals.py's WatchState/MovieWatchState/rewatch
    receivers; the TTL is a defense-in-depth backstop, same convention as
    AnalyticsMoviesView's own cache.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        cache_key = analytics_dashboard_cache_key(request.user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        profile = _get_profile(request.user)
        streak = _get_streak(request.user)

        today = timezone.now().date()
        total_episodes = WatchState.objects.filter(user=request.user).count()
        show_ids = list(Watchlist.objects.filter(user=request.user).values_list("show_id", flat=True))
        total_shows = len(show_ids)

        # Completed shows: every aired episode has a WatchState row. Two
        # flat grouped queries joined in Python (Phase 75.8), not one
        # queryset annotated with two Count(..., distinct=True) over
        # different relations off the same Watchlist row — that shape joins
        # both relations before Postgres can dedupe, exploding into
        # aired-count × watched-count intermediate rows per show before the
        # DISTINCT collapses it back down. Correct either way; this is the
        # cheaper query plan.
        aired_counts = dict(
            CachedEpisode.objects.filter(show_id__in=show_ids, air_date__lte=today)
            .values("show_id")
            # CachedEpisode's primary key is `tmdb_id`, not `id` — Count("id")
            # raises FieldError on this model. Count("pk") is PK-name-agnostic.
            .annotate(c=Count("pk"))
            .values_list("show_id", "c")
        )
        watched_counts = dict(
            WatchState.objects.filter(user=request.user, episode__show_id__in=show_ids)
            .values("episode__show_id")
            .annotate(c=Count("id"))
            .values_list("episode__show_id", "c")
        )
        # Simpler proxy: aired == watched for non-zero aired
        shows_completed = sum(
            1
            for show_id in show_ids
            if aired_counts.get(show_id, 0) > 0
            and watched_counts.get(show_id, 0) >= aired_counts.get(show_id, 0)
        )
        shows_archived = Watchlist.objects.filter(
            user=request.user, status=Watchlist.Status.ARCHIVED
        ).count()

        total_minutes = profile.total_time_watched
        total_rewatch_minutes = profile.total_rewatch_time_watched
        data = {
            "total_episodes_watched": total_episodes,
            "total_shows_tracked": total_shows,
            "total_minutes_watched": total_minutes,
            "total_hours_watched": round(total_minutes / 60, 1),
            "total_days_watched": round(total_minutes / 1440, 2),
            "current_streak": streak.current_streak,
            "longest_streak": streak.longest_streak,
            "total_streak_days": streak.total_streak_days,
            "badges_earned": len(profile.earned_badges),
            "shows_completed": shows_completed,
            "shows_archived": shows_archived,
            "total_rewatch_minutes_watched": total_rewatch_minutes,
            "total_rewatch_hours_watched": round(total_rewatch_minutes / 60, 1),
            "watch_time": {
                "total_minutes": total_minutes,
                "total_hours": round(total_minutes / 60, 1),
                "total_days": round(total_minutes / 1440, 2),
                "avg_minutes_per_day": round(total_minutes / max(streak.total_streak_days, 1), 1),
                "avg_minutes_per_week": round((total_minutes / max(streak.total_streak_days, 1)) * 7, 1),
                "avg_minutes_per_month": round((total_minutes / max(streak.total_streak_days, 1)) * 30, 1),
            },
        }
        serialized = DashboardSerializer(data).data
        cache.set(cache_key, serialized, ANALYTICS_DASHBOARD_CACHE_TTL_SECONDS)
        return Response(serialized)


class AnalyticsStatisticsView(APIView):
    """
    GET /api/analytics/statistics/

    Cached 300s (Phase 75.8) — the daily/weekly/monthly/yearly buckets here
    are the most query-heavy analytics view in the app, previously
    uncached. Same invalidation/TTL convention as AnalyticsDashboardView.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        cache_key = analytics_statistics_cache_key(request.user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        profile = _get_profile(request.user)
        streak = _get_streak(request.user)
        total_minutes = profile.total_time_watched

        # Daily stats (last 30 days)
        end_date = timezone.now().date()
        start_30 = end_date - timedelta(days=29)
        daily_qs = (
            WatchState.objects.filter(user=request.user, watched_at__date__gte=start_30)
            .values("watched_at__date")
            .annotate(
                episodes_watched=Count("id"),
                minutes_watched=Sum("episode__runtime_minutes"),
            )
            .order_by("watched_at__date")
        )
        day_map = {row["watched_at__date"]: dict(row) for row in daily_qs}
        for (day,), extra in _rewatch_period_counts(request.user, start_30, ["watched_at__date"]).items():
            bucket = day_map.setdefault(day, {"episodes_watched": 0, "minutes_watched": 0})
            bucket["episodes_watched"] += extra["episodes_watched"]
            bucket["minutes_watched"] += extra["minutes_watched"]
        daily = []
        d = start_30
        while d <= end_date:
            row = day_map.get(d, {"episodes_watched": 0, "minutes_watched": 0})
            daily.append(
                {
                    "period": str(d),
                    "label": d.strftime("%b %d"),
                    "episodes_watched": row["episodes_watched"],
                    "minutes_watched": row["minutes_watched"] or 0,
                }
            )
            d += timedelta(days=1)

        # Weekly stats (last 12 weeks)
        weekly_qs = (
            WatchState.objects.filter(
                user=request.user,
                watched_at__date__gte=end_date - timedelta(weeks=12),
            )
            .values("watched_at__week", "watched_at__year")
            .annotate(
                episodes_watched=Count("id"),
                minutes_watched=Sum("episode__runtime_minutes"),
            )
            .order_by("watched_at__year", "watched_at__week")
        )
        weekly_map: dict[tuple, dict] = {
            (row["watched_at__year"], row["watched_at__week"]): {
                "episodes_watched": row["episodes_watched"],
                "minutes_watched": row["minutes_watched"] or 0,
            }
            for row in weekly_qs
        }
        for key, extra in _rewatch_period_counts(
            request.user, end_date - timedelta(weeks=12), ["watched_at__year", "watched_at__week"]
        ).items():
            bucket = weekly_map.setdefault(key, {"episodes_watched": 0, "minutes_watched": 0})
            bucket["episodes_watched"] += extra["episodes_watched"]
            bucket["minutes_watched"] += extra["minutes_watched"]
        weekly = [
            {
                "period": f"{year}-W{week:02d}",
                "label": f"Week {week}",
                "episodes_watched": data["episodes_watched"],
                "minutes_watched": data["minutes_watched"],
            }
            for (year, week), data in sorted(weekly_map.items())
        ]

        # Monthly stats (last 12 months)
        monthly_qs = (
            WatchState.objects.filter(
                user=request.user,
                watched_at__date__gte=end_date - timedelta(days=365),
            )
            .values("watched_at__month", "watched_at__year")
            .annotate(
                episodes_watched=Count("id"),
                minutes_watched=Sum("episode__runtime_minutes"),
            )
            .order_by("watched_at__year", "watched_at__month")
        )
        monthly_map: dict[tuple, dict] = {
            (row["watched_at__year"], row["watched_at__month"]): {
                "episodes_watched": row["episodes_watched"],
                "minutes_watched": row["minutes_watched"] or 0,
            }
            for row in monthly_qs
        }
        for key, extra in _rewatch_period_counts(
            request.user, end_date - timedelta(days=365), ["watched_at__year", "watched_at__month"]
        ).items():
            bucket = monthly_map.setdefault(key, {"episodes_watched": 0, "minutes_watched": 0})
            bucket["episodes_watched"] += extra["episodes_watched"]
            bucket["minutes_watched"] += extra["minutes_watched"]
        monthly = [
            {
                "period": f"{year}-{month:02d}",
                "label": date(year, month, 1).strftime("%b %Y"),
                "episodes_watched": data["episodes_watched"],
                "minutes_watched": data["minutes_watched"],
            }
            for (year, month), data in sorted(monthly_map.items())
        ]

        # Yearly stats (all time)
        yearly_qs = (
            WatchState.objects.filter(user=request.user)
            .values("watched_at__year")
            .annotate(
                episodes_watched=Count("id"),
                minutes_watched=Sum("episode__runtime_minutes"),
            )
            .order_by("watched_at__year")
        )
        yearly_map: dict[tuple, dict] = {
            (row["watched_at__year"],): {
                "episodes_watched": row["episodes_watched"],
                "minutes_watched": row["minutes_watched"] or 0,
            }
            for row in yearly_qs
        }
        for key, extra in _rewatch_period_counts(request.user, date.min, ["watched_at__year"]).items():
            bucket = yearly_map.setdefault(key, {"episodes_watched": 0, "minutes_watched": 0})
            bucket["episodes_watched"] += extra["episodes_watched"]
            bucket["minutes_watched"] += extra["minutes_watched"]
        yearly = [
            {
                "period": str(year),
                "label": str(year),
                "episodes_watched": data["episodes_watched"],
                "minutes_watched": data["minutes_watched"],
            }
            for (year,), data in sorted(yearly_map.items())
        ]

        # Top shows by episodes watched
        top_shows_qs = (
            WatchState.objects.filter(user=request.user)
            .values("episode__show__tmdb_id", "episode__show__title", "episode__show__poster_path")
            .annotate(episodes_watched=Count("id"))
            .order_by("-episodes_watched")[:5]
        )
        top_shows = [
            {
                "tmdb_id": row["episode__show__tmdb_id"],
                "title": row["episode__show__title"],
                "poster_path": row["episode__show__poster_path"],
                "episodes_watched": row["episodes_watched"],
            }
            for row in top_shows_qs
        ]

        # Most watched day of week
        dow_qs = (
            WatchState.objects.filter(user=request.user)
            .values("watched_at__week_day")
            .annotate(c=Count("id"))
            .order_by("-c")
        )
        DOW_NAMES = ["", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        most_watched_day = DOW_NAMES[dow_qs[0]["watched_at__week_day"]] if dow_qs else None

        data = {
            "watch_time": {
                "total_minutes": total_minutes,
                "total_hours": round(total_minutes / 60, 1),
                "total_days": round(total_minutes / 1440, 2),
                "avg_minutes_per_day": round(total_minutes / max(streak.total_streak_days, 1), 1),
                "avg_minutes_per_week": round((total_minutes / max(streak.total_streak_days, 1)) * 7, 1),
                "avg_minutes_per_month": round((total_minutes / max(streak.total_streak_days, 1)) * 30, 1),
            },
            "daily": daily,
            "weekly": weekly,
            "monthly": monthly,
            "yearly": yearly,
            "top_shows": top_shows,
            "most_watched_day": most_watched_day,
        }
        serialized = StatisticsSerializer(data).data
        cache.set(cache_key, serialized, ANALYTICS_STATISTICS_CACHE_TTL_SECONDS)
        return Response(serialized)


class AnalyticsGenresView(APIView):
    """GET /api/analytics/genres/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        genre_data = _genre_stats(request.user)
        serializer = GenreStatSerializer(genre_data, many=True)
        return Response(serializer.data)


class AnalyticsMVPCharactersView(APIView):
    """
    GET /api/analytics/mvp-characters/

    Was named AnalyticsActorsView / "actors" — misleading, since no
    real-world cast/crew data is stored per-user anywhere in this schema.
    This is the user's own MVP-character votes (EpisodeInteraction.
    mvp_character_name, cast via MVPVotingSheet.tsx after an episode),
    tallied by vote count. Renamed for honesty; zero consumers referenced
    the old name (grepped clean — client never fetched this endpoint).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        character_qs = (
            EpisodeInteraction.objects.filter(
                user=request.user,
            )
            .exclude(mvp_character_name="")
            .values("mvp_character_name")
            .annotate(vote_count=Count("id"))
            .order_by("-vote_count")[:10]
        )
        data = [
            {"actor_name": row["mvp_character_name"], "vote_count": row["vote_count"]}
            for row in character_qs
        ]
        serializer = ActorStatSerializer(data, many=True)
        return Response(serializer.data)


class AnalyticsProvidersView(APIView):
    """
    GET /api/analytics/providers/

    Stub: streaming provider data is not stored per-user in the current
    schema (it exists in TMDB but is only fetched on-demand via
    WatchProvidersView and never persisted to the user's profile).
    Returns an empty list with a note rather than erroring.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "detail": "Provider analytics require per-user streaming provider tracking, which is not yet implemented.",
                "results": [],
            }
        )


class AnalyticsCompletionView(APIView):
    """GET /api/analytics/completion/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.now().date()

        # Total aired episodes across all tracked shows. Two flat grouped
        # queries joined in Python (Phase 75.8), not one queryset annotated
        # with two Count(..., distinct=True) over different relations off
        # the same Watchlist row — see AnalyticsDashboardView's identical
        # fix for the full reasoning. The old `total_eps` annotation here
        # was never even read below; dropped rather than carried forward.
        show_ids = list(Watchlist.objects.filter(user=request.user).values_list("show_id", flat=True))
        aired_counts = dict(
            CachedEpisode.objects.filter(show_id__in=show_ids, air_date__lte=today)
            .values("show_id")
            # CachedEpisode's primary key is `tmdb_id`, not `id` — Count("id")
            # raises FieldError on this model. Count("pk") is PK-name-agnostic.
            .annotate(c=Count("pk"))
            .values_list("show_id", "c")
        )
        watched_counts = dict(
            WatchState.objects.filter(user=request.user, episode__show_id__in=show_ids)
            .values("episode__show_id")
            .annotate(c=Count("id"))
            .values_list("episode__show_id", "c")
        )

        total_aired = 0
        total_watched = 0
        total_shows = 0
        completed_shows = 0

        for show_id in show_ids:
            aired = aired_counts.get(show_id, 0)
            watched = watched_counts.get(show_id, 0)
            total_aired += aired
            total_watched += watched
            total_shows += 1
            if aired > 0 and watched >= aired:
                completed_shows += 1

        ep_pct = round((total_watched / total_aired) * 100, 1) if total_aired else 0.0
        show_pct = round((completed_shows / total_shows) * 100, 1) if total_shows else 0.0

        # Movies ARE tracked separately in this schema (MovieWatchlist/
        # MovieWatchState) — the "not tracked" comment this replaced was
        # simply wrong (see AnalyticsMoviesView, which reads the same two
        # tables). A movie has no partial-progress state, so "completion"
        # here just means watched-or-not, mirroring shows_completed's
        # watched-or-not semantics at the show level (not episode level).
        movies_tracked = MovieWatchlist.objects.filter(user=request.user).count()
        movies_watched = MovieWatchState.objects.filter(user=request.user).count()
        movie_pct = round((movies_watched / movies_tracked) * 100, 1) if movies_tracked else 0.0

        data = {
            "episode_completion_pct": ep_pct,
            "season_completion_pct": ep_pct,   # season-level tracking not stored; proxy with ep%
            "show_completion_pct": show_pct,
            "movie_completion_pct": movie_pct,
            "movies_watched": movies_watched,
            "movies_tracked": movies_tracked,
            "episodes_watched": total_watched,
            "episodes_aired": total_aired,
            "shows_completed": completed_shows,
            "shows_total": total_shows,
        }
        serializer = CompletionSerializer(data)
        return Response(serializer.data)


class AnalyticsMoviesView(APIView):
    """
    GET /api/analytics/movies/

    The Movies-segment counterpart to the TV-only analytics screen
    (Phase 74/Group H) — mounted as a separate SegmentedControl tab on
    the client, not merged into the existing TV numbers (which must not
    change). ~7 queries, cached 300s and busted by the same
    MovieWatchlist/MovieWatchState signal receivers movie_watchlist_cache_key
    already uses (signals.py) — analytics_movies_cache_key was added to
    that same pair rather than inventing a new invalidation path.

    Deliberately NOT building a top-actor/top-director section: no
    per-user movie credits data is persisted anywhere (MovieCache has no
    cast/crew fields), and faking it would be a third dishonest-data
    surface next to AnalyticsProvidersView's already-honest empty stub.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        cache_key = analytics_movies_cache_key(user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        movies_tracked = MovieWatchlist.objects.filter(user=user).count()

        runtime_agg = MovieWatchState.objects.filter(user=user).aggregate(
            total=Sum("movie__runtime_minutes"),
            avg=Avg("movie__runtime_minutes"),
            count=Count("id"),
        )
        movies_watched = runtime_agg["count"] or 0
        total_runtime = runtime_agg["total"] or 0
        avg_runtime = round(runtime_agg["avg"], 1) if runtime_agg["avg"] else 0.0

        watched_this_year = MovieWatchState.objects.filter(
            user=user, watched_at__year=timezone.now().year
        ).count()

        longest_ws = (
            MovieWatchState.objects.filter(user=user)
            .select_related("movie")
            .order_by("-movie__runtime_minutes")
            .first()
        )
        longest_movie = None
        if longest_ws:
            longest_movie = {
                "tmdb_id": longest_ws.movie_id,
                "title": longest_ws.movie.title,
                "poster_path": longest_ws.movie.poster_path,
                "runtime_minutes": longest_ws.movie.runtime_minutes,
            }

        # Genre trick: MovieCache.genres_string is a comma-separated combo
        # ("Drama, Comedy, Thriller"), not an ArrayField, and there are
        # only a few dozen distinct combos across any real library — group
        # by the raw combo string in the DB, then split+tally in Python
        # over those few dozen rows. Iterating every watched-movie row
        # individually (the _genre_stats anti-pattern used for shows,
        # which needs it because CachedShow.genres IS an ArrayField with
        # no combo to group by) would be the wrong shape here.
        genre_counter: Counter = Counter()
        for row in (
            MovieWatchState.objects.filter(user=user)
            .values("movie__genres_string")
            .annotate(count=Count("id"))
        ):
            for genre in (row["movie__genres_string"] or "").split(","):
                genre = genre.strip()
                if genre:
                    genre_counter[genre] += row["count"]

        top_genres = [
            {
                "genre": genre,
                "count": count,
                "percentage": round((count / movies_watched) * 100, 1) if movies_watched else 0.0,
            }
            for genre, count in genre_counter.most_common(10)
        ]

        decade_counter: Counter = Counter()
        for release_date in MovieWatchState.objects.filter(user=user).values_list(
            "movie__release_date", flat=True
        ):
            if release_date:
                decade_counter[f"{(release_date.year // 10) * 10}s"] += 1
        by_decade = [
            {"decade": decade, "count": count} for decade, count in sorted(decade_counter.items())
        ]

        recent_movies = [
            {
                "tmdb_id": ws.movie_id,
                "title": ws.movie.title,
                "poster_path": ws.movie.poster_path,
                "watched_at": ws.watched_at,
            }
            for ws in (
                MovieWatchState.objects.filter(user=user)
                .select_related("movie")
                .order_by("-watched_at")[:5]
            )
        ]

        data = {
            "movies_watched": movies_watched,
            "movies_tracked": movies_tracked,
            "completion_pct": round((movies_watched / movies_tracked) * 100, 1) if movies_tracked else 0.0,
            "total_runtime_minutes": total_runtime,
            "average_runtime_minutes": avg_runtime,
            "watched_this_year": watched_this_year,
            "longest_movie": longest_movie,
            "top_genres": top_genres,
            "by_decade": by_decade,
            "recent_movies": recent_movies,
        }
        serialized = AnalyticsMoviesSerializer(data).data
        cache.set(cache_key, serialized, ANALYTICS_MOVIES_CACHE_TTL_SECONDS)
        return Response(serialized)


class AnalyticsHeatmapView(APIView):
    """
    GET /api/analytics/heatmap/?days=365 — dense day-by-day window,
    uncached (staleness here is noticeable: mark an episode, tab back,
    today's cell should light up immediately).

    GET /api/analytics/heatmap/?range=all — sparse, year-grouped full
    history (Phase 74/Group G), cached 900s under a separate key. Two
    genuinely different response shapes on one endpoint rather than a
    second URL, since both are "the heatmap, at different zoom levels."
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.query_params.get("range") == "all":
            return self._all_time(request.user)

        try:
            days = int(request.query_params.get("days", 365))
            days = max(7, min(days, 730))
        except (ValueError, TypeError):
            days = 365

        heatmap_data = _heatmap_for_user(request.user, days=days)
        serializer = HeatmapDaySerializer(heatmap_data, many=True)
        return Response(serializer.data)

    def _all_time(self, user) -> Response:
        cache_key = analytics_heatmap_all_cache_key(user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        payload = _heatmap_all_time_for_user(user)
        data = HeatmapAllTimeSerializer(payload).data
        cache.set(cache_key, data, ANALYTICS_HEATMAP_ALL_CACHE_TTL_SECONDS)
        return Response(data)


class AnalyticsStreakView(APIView):
    """GET /api/analytics/streak/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        streak = _get_streak(request.user)
        recent = _heatmap_for_user(request.user, days=30)

        data = {
            "current_streak": streak.current_streak,
            "longest_streak": streak.longest_streak,
            "total_streak_days": streak.total_streak_days,
            "last_watch_date": streak.last_watch_date,
            "recent_activity": recent,
        }
        serializer = StreakSerializer(data)
        return Response(serializer.data)


class AnalyticsYearReviewView(APIView):
    """GET /api/analytics/year-review/?year=2025"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_year = timezone.now().year
        try:
            year = int(request.query_params.get("year", current_year))
        except (ValueError, TypeError):
            year = current_year

        # Episode watches in the year
        year_qs = WatchState.objects.filter(
            user=request.user, watched_at__year=year
        )
        total_episodes = year_qs.count()
        total_minutes = year_qs.aggregate(
            m=Sum("episode__runtime_minutes")
        )["m"] or 0

        # Most watched show
        top_show_qs = (
            year_qs.values(
                "episode__show__tmdb_id",
                "episode__show__title",
                "episode__show__poster_path",
            )
            .annotate(c=Count("id"))
            .order_by("-c")
        )
        most_watched_show = None
        if top_show_qs:
            ts = top_show_qs[0]
            most_watched_show = {
                "tmdb_id": ts["episode__show__tmdb_id"],
                "title": ts["episode__show__title"],
                "poster_path": ts["episode__show__poster_path"],
                "episodes_watched": ts["c"],
            }

        top_shows = [
            {
                "tmdb_id": r["episode__show__tmdb_id"],
                "title": r["episode__show__title"],
                "poster_path": r["episode__show__poster_path"],
                "episodes_watched": r["c"],
            }
            for r in top_show_qs[:5]
        ]

        # Favorite genre
        genre_counter: Counter = Counter()
        for ws in year_qs.select_related("episode__show").order_by():
            for g in (ws.episode.show.genres or []):
                genre_counter[g] += 1
        favorite_genre = genre_counter.most_common(1)[0][0] if genre_counter else None

        top_genres = [
            {"genre": g, "count": c} for g, c in genre_counter.most_common(5)
        ]

        # Favorite actor (most MVP votes in the year)
        actor_qs = (
            EpisodeInteraction.objects.filter(user=request.user, created_at__year=year)
            .exclude(mvp_character_name="")
            .values("mvp_character_name")
            .annotate(c=Count("id"))
            .order_by("-c")
        )
        favorite_actor = actor_qs[0]["mvp_character_name"] if actor_qs else None

        # Shows *currently* finished (all-time, not year-scoped) — no
        # per-show "completed on" date is stored anywhere in this schema,
        # only the live watched/aired counts, so this can only answer "is
        # this show fully caught up as of today", not "did the user finish
        # it specifically during `year`". Same honest limitation as
        # longest_streak below. Scoping it correctly would need a new
        # completed_at column written the moment a show's last episode is
        # marked watched — out of scope here.
        today = timezone.now().date()
        # Two flat grouped queries joined in Python (Phase 75.8) — see
        # AnalyticsDashboardView's identical fix for the full reasoning.
        year_review_show_ids = list(
            Watchlist.objects.filter(user=request.user).values_list("show_id", flat=True)
        )
        year_review_aired_counts = dict(
            CachedEpisode.objects.filter(show_id__in=year_review_show_ids, air_date__lte=today)
            .values("show_id")
            # CachedEpisode's primary key is `tmdb_id`, not `id` — Count("id")
            # raises FieldError on this model. Count("pk") is PK-name-agnostic.
            .annotate(c=Count("pk"))
            .values_list("show_id", "c")
        )
        year_review_watched_counts = dict(
            WatchState.objects.filter(user=request.user, episode__show_id__in=year_review_show_ids)
            .values("episode__show_id")
            .annotate(c=Count("id"))
            .values_list("episode__show_id", "c")
        )
        shows_finished = sum(
            1
            for show_id in year_review_show_ids
            if year_review_aired_counts.get(show_id, 0) > 0
            and year_review_watched_counts.get(show_id, 0) >= year_review_aired_counts.get(show_id, 0)
        )

        # Biggest month (most minutes)
        biggest_month_qs = (
            year_qs.values("watched_at__month")
            .annotate(m=Sum("episode__runtime_minutes"))
            .order_by("-m")
        )
        biggest_month = None
        if biggest_month_qs:
            bm = biggest_month_qs[0]["watched_at__month"]
            biggest_month = calendar.month_name[bm]

        # Biggest week
        biggest_week_qs = (
            year_qs.values("watched_at__week", "watched_at__year")
            .annotate(m=Sum("episode__runtime_minutes"))
            .order_by("-m")
        )
        biggest_week = None
        if biggest_week_qs:
            bw = biggest_week_qs[0]
            biggest_week = f"Week {bw['watched_at__week']}, {bw['watched_at__year']}"

        # Longest streak (all-time; year-scoped streak is complex, use profile value)
        streak = _get_streak(request.user)

        data = {
            "year": year,
            "hours_watched": round(total_minutes / 60, 1),
            "episodes_watched": total_episodes,
            "shows_finished": shows_finished,
            "most_watched_show": most_watched_show,
            "favorite_genre": favorite_genre,
            "favorite_actor": favorite_actor,
            "longest_streak": streak.longest_streak,
            "biggest_month": biggest_month,
            "biggest_week": biggest_week,
            "top_shows": top_shows,
            "top_genres": top_genres,
        }
        serializer = YearReviewSerializer(data)
        return Response(serializer.data)


class AnalyticsMonthlySummaryView(APIView):
    """
    GET /api/analytics/monthly-summary/?year=2025

    Cached 900s per (user, year) (Phase 75.8) — see
    analytics_monthly_summary_cache_key's own comment for why only the
    current year's key is signal-busted.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_year = timezone.now().year
        try:
            year = int(request.query_params.get("year", current_year))
        except (ValueError, TypeError):
            year = current_year

        cache_key = analytics_monthly_summary_cache_key(request.user.id, year)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached)

        # Was 12 months × ~4 queries each (count/sum/genre-loop/top-show) —
        # one query for the whole year plus a single Python pass instead,
        # same "select_related + Counter" pattern _genre_stats/
        # _compute_badge_progress already use for ArrayField genre tallying.
        year_qs = (
            WatchState.objects.filter(user=request.user, watched_at__year=year)
            .select_related("episode__show")
            .order_by()
        )

        months: dict[int, dict] = {
            m: {"eps": 0, "mins": 0, "genres": Counter(), "shows": Counter(), "show_meta": {}}
            for m in range(1, 13)
        }
        for ws in year_qs:
            bucket = months[ws.watched_at.month]
            bucket["eps"] += 1
            bucket["mins"] += ws.episode.runtime_minutes or 0
            show = ws.episode.show
            for g in (show.genres or []):
                bucket["genres"][g] += 1
            bucket["shows"][show.tmdb_id] += 1
            bucket["show_meta"][show.tmdb_id] = {"title": show.title, "poster_path": show.poster_path}

        results = []
        for month_num in range(1, 13):
            bucket = months[month_num]
            top_genre = bucket["genres"].most_common(1)[0][0] if bucket["genres"] else None

            top_show = None
            if bucket["shows"]:
                top_show_id, top_count = bucket["shows"].most_common(1)[0]
                meta = bucket["show_meta"][top_show_id]
                top_show = {
                    "tmdb_id": top_show_id,
                    "title": meta["title"],
                    "poster_path": meta["poster_path"],
                    "episodes_watched": top_count,
                }

            results.append(
                {
                    "month": f"{year}-{month_num:02d}",
                    "label": f"{calendar.month_name[month_num]} {year}",
                    "hours_watched": round(bucket["mins"] / 60, 1),
                    "episodes_watched": bucket["eps"],
                    # No per-show "completed on" date is stored anywhere in
                    # this schema (same limitation as
                    # AnalyticsYearReviewView's shows_finished above) — 0
                    # rather than a guess, not "completed shows all-time".
                    "shows_finished": 0,
                    "top_genre": top_genre,
                    "top_show": top_show,
                }
            )

        serialized = MonthlySummaryItemSerializer(results, many=True).data
        cache.set(cache_key, serialized, ANALYTICS_MONTHLY_SUMMARY_CACHE_TTL_SECONDS)
        return Response(serialized)


class AnalyticsAchievementsView(APIView):
    """GET /api/analytics/achievements/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = _get_profile(request.user)
        streak = _get_streak(request.user)
        achievements = _compute_badge_progress(request.user, profile, streak)
        serializer = AchievementItemSerializer(achievements, many=True)
        return Response(serializer.data)
