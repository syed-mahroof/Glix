"""A year-scoped viewing diary, including first watches and repeat watches.

Stream scalar rows rather than materializing episode/model graphs. Rankings
and the library reuse the same pass; no per-title queries or external APIs.
"""

import calendar
from collections import Counter
from datetime import datetime, timedelta

from django.db.models import Count, Max
from django.db.models.functions import ExtractYear
from django.utils import timezone

from core.models import (CachedEpisode, CachedShow, EpisodeInteraction, MovieReview,
                         MovieRewatch, MovieWatchState, RewatchEpisodeState, ShowReview,
                         WatchState)


def build_year_review(user, year, zone):
    now = timezone.now()
    start = datetime(year, 1, 1, tzinfo=zone)
    end = datetime(year + 1, 1, 1, tzinfo=zone)
    sources = [
        (WatchState.objects.filter(user=user), "episode__show", "episode__runtime_minutes", "tv", False),
        (RewatchEpisodeState.objects.filter(rewatch__user=user), "episode__show", "episode__runtime_minutes", "tv", True),
        (MovieWatchState.objects.filter(user=user), "movie", "movie__runtime_minutes", "movie", False),
        (MovieRewatch.objects.filter(user=user), "movie", "movie__runtime_minutes", "movie", True),
    ]
    months = [{"month": m, "label": calendar.month_name[m], "series_minutes": 0,
               "movie_minutes": 0, "episodes": 0, "movies": 0, "rewatches": 0,
               "top_show": None, "top_movie": None} for m in range(1, 13)]
    monthly_titles = [Counter() for _ in months]
    days, weeks, weekdays, genres = Counter(), Counter(), Counter(), Counter()
    library = {}
    available_years = {year, now.astimezone(zone).year}
    first_episodes = first_movies = episode_rewatches = movie_rewatches = unknown_runtime = 0
    for qs, prefix, runtime_field, media_type, rewatch in sources:
        available_years.update(qs.filter(watched_at__lte=now).order_by()
                               .annotate(y=ExtractYear("watched_at", tzinfo=zone))
                               .values_list("y", flat=True).distinct())
        genre_field = f"{prefix}__genres" if media_type == "tv" else f"{prefix}__genres_string"
        fields = ["watched_at", f"{prefix}__pk", f"{prefix}__title", f"{prefix}__poster_path",
                  genre_field, runtime_field]
        events = qs.filter(watched_at__gte=start, watched_at__lt=end, watched_at__lte=now)
        for row in events.order_by().values(*fields).iterator(chunk_size=1000):
            watched = row["watched_at"].astimezone(zone)
            day = watched.date()
            minutes = row[runtime_field] or 0
            unknown_runtime += minutes == 0
            title_key = (media_type, row[f"{prefix}__pk"])
            item = library.setdefault(title_key, {
                "tmdb_id": title_key[1], "media_type": media_type, "title": row[f"{prefix}__title"],
                "poster_path": row[f"{prefix}__poster_path"], "minutes_watched": 0,
                "episodes_watched": 0, "watches": 0, "rewatches": 0,
                "first_watched": day.isoformat(), "last_watched": day.isoformat(), "rating": None,
            })
            item["minutes_watched"] += minutes
            item["episodes_watched"] += media_type == "tv"
            item["watches"] += 1
            item["rewatches"] += rewatch
            item["first_watched"] = min(item["first_watched"], day.isoformat())
            item["last_watched"] = max(item["last_watched"], day.isoformat())
            bucket = months[day.month - 1]
            bucket["series_minutes" if media_type == "tv" else "movie_minutes"] += minutes
            bucket["episodes" if media_type == "tv" else "movies"] += 1
            bucket["rewatches"] += rewatch
            monthly_titles[day.month - 1][title_key] += minutes or 1
            if media_type == "tv":
                episode_rewatches += rewatch
                first_episodes += not rewatch
                names = row[genre_field] or []
            else:
                movie_rewatches += rewatch
                first_movies += not rewatch
                names = [g.strip() for g in (row[genre_field] or "").split(",") if g.strip()]
            genres.update(names)
            days[day] += 1
            weeks[day - timedelta(days=day.weekday())] += minutes
            weekdays[day.weekday()] += 1

    # Ratings are today's personal ratings for titles watched that year. They
    # are not historical snapshots: the UI labels this distinction.
    for model, kind, relation in [(ShowReview, "tv", "show_id"), (MovieReview, "movie", "movie_id")]:
        ids = [key[1] for key in library if key[0] == kind]
        for title_id, rating in model.objects.filter(user=user, **{f"{relation}__in": ids}).values_list(relation, "rating"):
            library[(kind, title_id)]["rating"] = float(rating)

    shows = sorted((item for key, item in library.items() if key[0] == "tv"),
                   key=lambda item: (-item["minutes_watched"], -item["watches"], item["tmdb_id"]))
    movies = sorted((item for key, item in library.items() if key[0] == "movie"),
                    key=lambda item: (-(item["rating"] or 0), -item["watches"], -item["minutes_watched"], item["tmdb_id"]))
    for bucket, counts in zip(months, monthly_titles):
        for kind, field in [("tv", "top_show"), ("movie", "top_movie")]:
            keys = [key for key in counts if key[0] == kind]
            if keys:
                winner = min(keys, key=lambda key: (-counts[key], key[1]))
                bucket[field] = {"tmdb_id": winner[1], "title": library[winner]["title"]}

    # Only finalised shows with full known regular-season coverage qualify.
    # Completion date comes from first-watch timestamps, so a show finished
    # last year never becomes a finish this year merely because it is watched.
    finished = 0
    ended = CachedShow.objects.filter(pk__in=[s["tmdb_id"] for s in shows],
                                      status__in=["ENDED", "CANCELED"], total_episodes__gt=0)
    completed = {row["episode__show_id"]: row for row in WatchState.objects.filter(
        user=user, episode__show_id__in=ended.values("pk"), episode__season_number__gt=0,
        watched_at__lte=now).order_by().values("episode__show_id").annotate(c=Count("pk"), last=Max("watched_at"))}
    coverage = {row["show_id"]: row for row in CachedEpisode.objects.filter(
        show_id__in=ended.values("pk"), season_number__gt=0).order_by().values("show_id")
                .annotate(c=Count("pk"), seasons=Count("season_number", distinct=True))}
    for show in ended:
        watched, cached = completed.get(show.pk), coverage.get(show.pk)
        if watched and cached and cached["seasons"] >= show.total_seasons > 0 \
                and cached["c"] >= show.total_episodes and watched["c"] == cached["c"] \
                and start <= watched["last"] < end:
            finished += 1

    longest = run = 0
    previous = None
    for day in sorted(days):
        run = run + 1 if previous and day == previous + timedelta(days=1) else 1
        longest = max(longest, run)
        previous = day
    series_minutes = sum(m["series_minutes"] for m in months)
    movie_minutes = sum(m["movie_minutes"] for m in months)
    total_minutes = series_minutes + movie_minutes
    biggest = max(months, key=lambda m: (m["series_minutes"] + m["movie_minutes"], m["episodes"] + m["movies"], -m["month"])) if library else None
    biggest_week = min(weeks, key=lambda d: (-weeks[d], d)) if weeks else None
    busiest = min(days, key=lambda d: (-days[d], d)) if days else None
    actors = EpisodeInteraction.objects.filter(user=user, episode__watch_states__user=user,
        episode__watch_states__watched_at__gte=start, episode__watch_states__watched_at__lt=end,
        episode__watch_states__watched_at__lte=now).exclude(mvp_character_name="").order_by()
    actor = actors.values("mvp_character_name").annotate(c=Count("pk")).order_by("-c", "mvp_character_name").first()
    ratings = [i["rating"] for i in library.values() if i["rating"] is not None]
    return {
        "year": year, "timezone": str(zone), "is_year_to_date": year == now.astimezone(zone).year,
        "available_years": sorted(available_years, reverse=True), "hours_watched": round(total_minutes / 60, 1),
        "series_hours": round(series_minutes / 60, 1), "movie_hours": round(movie_minutes / 60, 1),
        "minutes_watched": total_minutes, "episodes_watched": first_episodes + episode_rewatches,
        "movies_watched": first_movies + movie_rewatches, "first_watch_episodes": first_episodes,
        "first_watch_movies": first_movies, "episode_rewatches": episode_rewatches, "movie_rewatches": movie_rewatches,
        "unique_shows": len(shows), "unique_movies": len(movies), "shows_finished": finished,
        "active_days": len(days), "minutes_per_active_day": round(total_minutes / len(days), 1) if days else 0,
        "unknown_runtime_watches": unknown_runtime, "longest_streak": longest,
        "busiest_day": {"date": busiest.isoformat(), "watches": days[busiest]} if busiest else None,
        "favorite_weekday": calendar.day_name[weekdays.most_common(1)[0][0]] if weekdays else None,
        "most_watched_show": shows[0] if shows else None, "favorite_genre": genres.most_common(1)[0][0] if genres else None,
        "favorite_actor": actor["mvp_character_name"] if actor else None,
        "biggest_month": biggest["label"] if biggest else None,
        "biggest_week": f"Week of {biggest_week.isoformat()}" if biggest_week else None,
        "top_shows": shows[:5], "top_movies": movies[:5], "watched_shows": shows, "watched_movies": movies,
        "top_genres": [{"genre": g, "count": c} for g, c in genres.most_common(5)], "months": months,
        "rated_titles": len(ratings), "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else None,
    }
