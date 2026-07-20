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

from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.analytics_serializers import (
    AchievementItemSerializer,
    ActorStatSerializer,
    CompletionSerializer,
    DashboardSerializer,
    GenreStatSerializer,
    HeatmapDaySerializer,
    MonthlySummaryItemSerializer,
    StatisticsSerializer,
    StreakSerializer,
    YearReviewSerializer,
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
    MovieWatchState,
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


def _watch_time_summary(total_minutes: int) -> dict:
    """Convert raw minutes into a WatchTimeSummary dict."""
    total_hours = round(total_minutes / 60, 1)
    total_days = round(total_minutes / 1440, 2)
    # Use 90 days of data to compute daily average
    return {
        "total_minutes": total_minutes,
        "total_hours": total_hours,
        "total_days": total_days,
        "avg_minutes_per_day": round(total_minutes / 90, 1),
        "avg_minutes_per_week": round(total_minutes / (90 / 7), 1),
        "avg_minutes_per_month": round(total_minutes / 3, 1),
    }


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

    # Determine max for normalising intensity (1–4 scale, 0 = no activity)
    max_eps = max((v["episodes_watched"] for v in activity_by_date.values()), default=1)

    result = []
    current = start_date
    while current <= end_date:
        data = activity_by_date.get(current)
        if data:
            eps = data["episodes_watched"]
            # Map to 1–4 based on quartile of max
            if eps >= max_eps * 0.75:
                intensity = 4
            elif eps >= max_eps * 0.5:
                intensity = 3
            elif eps >= max_eps * 0.25:
                intensity = 2
            else:
                intensity = 1
        else:
            eps = 0
            intensity = 0
        result.append(
            {
                "date": current,
                "episodes_watched": eps,
                "minutes_watched": activity_by_date.get(current, {}).get("minutes_watched", 0),
                "intensity": intensity,
            }
        )
        current += timedelta(days=1)

    return result


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

    # Completed shows: aired == watched (aired > 0)
    today = timezone.now().date()
    completed_shows = Watchlist.objects.filter(user=user).annotate(
        aired=Count("show__episodes", filter=Q(show__episodes__air_date__lte=today)),
        watched=Count(
            "show__episodes__watch_states",
            filter=Q(show__episodes__watch_states__user=user),
        ),
    ).filter(aired__gt=0, watched__gte=models_aired()).count()

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


def models_aired():
    """Placeholder for annotated field name — used in filter."""
    return "watched"


# ─── Views ────────────────────────────────────────────────────────────────

class AnalyticsDashboardView(APIView):
    """GET /api/analytics/dashboard/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = _get_profile(request.user)
        streak = _get_streak(request.user)

        today = timezone.now().date()
        total_episodes = WatchState.objects.filter(user=request.user).count()
        total_shows = Watchlist.objects.filter(user=request.user).count()

        # Completed shows: every aired episode has a WatchState row
        completed_qs = Watchlist.objects.filter(user=request.user).annotate(
            aired=Count(
                "show__episodes",
                filter=Q(show__episodes__air_date__lte=today),
                distinct=True,
            ),
            watched=Count(
                "show__episodes__watch_states",
                filter=Q(show__episodes__watch_states__user=request.user),
                distinct=True,
            ),
        )
        shows_completed = completed_qs.filter(aired__gt=0, watched__gte=Count(
            "show__episodes",
            filter=Q(show__episodes__air_date__lte=today),
            distinct=True,
        )).count()
        # Simpler proxy: aired == watched for non-zero aired
        shows_completed = sum(
            1 for e in completed_qs if e.aired > 0 and e.watched >= e.aired
        )
        shows_archived = Watchlist.objects.filter(
            user=request.user, status=Watchlist.Status.ARCHIVED
        ).count()

        total_minutes = profile.total_time_watched
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
            "watch_time": {
                "total_minutes": total_minutes,
                "total_hours": round(total_minutes / 60, 1),
                "total_days": round(total_minutes / 1440, 2),
                "avg_minutes_per_day": round(total_minutes / max(streak.total_streak_days, 1), 1),
                "avg_minutes_per_week": round((total_minutes / max(streak.total_streak_days, 1)) * 7, 1),
                "avg_minutes_per_month": round((total_minutes / max(streak.total_streak_days, 1)) * 30, 1),
            },
        }
        serializer = DashboardSerializer(data)
        return Response(serializer.data)


class AnalyticsStatisticsView(APIView):
    """GET /api/analytics/statistics/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
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
        day_map = {row["watched_at__date"]: row for row in daily_qs}
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
        weekly = [
            {
                "period": f"{row['watched_at__year']}-W{row['watched_at__week']:02d}",
                "label": f"Week {row['watched_at__week']}",
                "episodes_watched": row["episodes_watched"],
                "minutes_watched": row["minutes_watched"] or 0,
            }
            for row in weekly_qs
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
        monthly = [
            {
                "period": f"{row['watched_at__year']}-{row['watched_at__month']:02d}",
                "label": date(row["watched_at__year"], row["watched_at__month"], 1).strftime("%b %Y"),
                "episodes_watched": row["episodes_watched"],
                "minutes_watched": row["minutes_watched"] or 0,
            }
            for row in monthly_qs
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
        yearly = [
            {
                "period": str(row["watched_at__year"]),
                "label": str(row["watched_at__year"]),
                "episodes_watched": row["episodes_watched"],
                "minutes_watched": row["minutes_watched"] or 0,
            }
            for row in yearly_qs
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
        serializer = StatisticsSerializer(data)
        return Response(serializer.data)


class AnalyticsGenresView(APIView):
    """GET /api/analytics/genres/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        genre_data = _genre_stats(request.user)
        serializer = GenreStatSerializer(genre_data, many=True)
        return Response(serializer.data)


class AnalyticsActorsView(APIView):
    """GET /api/analytics/actors/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        actor_qs = (
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
            for row in actor_qs
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

        # Total aired episodes across all tracked shows
        watchlist_qs = Watchlist.objects.filter(user=request.user).annotate(
            aired=Count(
                "show__episodes",
                filter=Q(show__episodes__air_date__lte=today),
                distinct=True,
            ),
            watched=Count(
                "show__episodes__watch_states",
                filter=Q(show__episodes__watch_states__user=request.user),
                distinct=True,
            ),
            total_eps=Count("show__episodes", distinct=True),
        )

        total_aired = 0
        total_watched = 0
        total_shows = 0
        completed_shows = 0

        for entry in watchlist_qs:
            total_aired += entry.aired
            total_watched += entry.watched
            total_shows += 1
            if entry.aired > 0 and entry.watched >= entry.aired:
                completed_shows += 1

        ep_pct = round((total_watched / total_aired) * 100, 1) if total_aired else 0.0
        show_pct = round((completed_shows / total_shows) * 100, 1) if total_shows else 0.0

        data = {
            "episode_completion_pct": ep_pct,
            "season_completion_pct": ep_pct,   # season-level tracking not stored; proxy with ep%
            "show_completion_pct": show_pct,
            "movie_completion_pct": 0.0,       # movies not tracked separately in this schema
            "episodes_watched": total_watched,
            "episodes_aired": total_aired,
            "shows_completed": completed_shows,
            "shows_total": total_shows,
        }
        serializer = CompletionSerializer(data)
        return Response(serializer.data)


class AnalyticsHeatmapView(APIView):
    """GET /api/analytics/heatmap/?days=365"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            days = int(request.query_params.get("days", 365))
            days = max(7, min(days, 730))
        except (ValueError, TypeError):
            days = 365

        heatmap_data = _heatmap_for_user(request.user, days=days)
        serializer = HeatmapDaySerializer(heatmap_data, many=True)
        return Response(serializer.data)


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

        # Shows finished in the year (completed ≥ 1 show during this year)
        today = timezone.now().date()
        shows_finished = 0
        for entry in Watchlist.objects.filter(user=request.user).annotate(
            aired=Count(
                "show__episodes",
                filter=Q(show__episodes__air_date__lte=today),
                distinct=True,
            ),
            watched=Count(
                "show__episodes__watch_states",
                filter=Q(show__episodes__watch_states__user=request.user),
                distinct=True,
            ),
        ):
            if entry.aired > 0 and entry.watched >= entry.aired:
                shows_finished += 1

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
    """GET /api/analytics/monthly-summary/?year=2025"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        current_year = timezone.now().year
        try:
            year = int(request.query_params.get("year", current_year))
        except (ValueError, TypeError):
            year = current_year

        today = timezone.now().date()
        results = []

        for month_num in range(1, 13):
            month_qs = WatchState.objects.filter(
                user=request.user,
                watched_at__year=year,
                watched_at__month=month_num,
            )
            eps = month_qs.count()
            mins = month_qs.aggregate(m=Sum("episode__runtime_minutes"))["m"] or 0

            # Top genre this month
            genre_counter: Counter = Counter()
            for ws in month_qs.select_related("episode__show").order_by():
                for g in (ws.episode.show.genres or []):
                    genre_counter[g] += 1
            top_genre = genre_counter.most_common(1)[0][0] if genre_counter else None

            # Top show this month
            top_show_qs = (
                month_qs.values(
                    "episode__show__tmdb_id",
                    "episode__show__title",
                    "episode__show__poster_path",
                )
                .annotate(c=Count("id"))
                .order_by("-c")
            )
            top_show = None
            if top_show_qs:
                ts = top_show_qs[0]
                top_show = {
                    "tmdb_id": ts["episode__show__tmdb_id"],
                    "title": ts["episode__show__title"],
                    "poster_path": ts["episode__show__poster_path"],
                    "episodes_watched": ts["c"],
                }

            # Shows finished this month (rough: completed shows with last watch in this month)
            # Simpler: completed shows count (all-time) — we don't track per-month completion
            shows_finished = 0

            results.append(
                {
                    "month": f"{year}-{month_num:02d}",
                    "label": f"{calendar.month_name[month_num]} {year}",
                    "hours_watched": round(mins / 60, 1),
                    "episodes_watched": eps,
                    "shows_finished": shows_finished,
                    "top_genre": top_genre,
                    "top_show": top_show,
                }
            )

        serializer = MonthlySummaryItemSerializer(results, many=True)
        return Response(serializer.data)


class AnalyticsAchievementsView(APIView):
    """GET /api/analytics/achievements/"""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = _get_profile(request.user)
        streak = _get_streak(request.user)
        achievements = _compute_badge_progress(request.user, profile, streak)
        serializer = AchievementItemSerializer(achievements, many=True)
        return Response(serializer.data)
