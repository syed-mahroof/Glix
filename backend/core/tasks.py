"""
backend/core/tasks.py

Celery background jobs. Keep the local TMDB cache warm and consistent
without blocking any request/response cycle:
- refresh_show_cache: re-syncs one show + its currently-cached seasons.
- sync_active_shows: periodic sweep of all RETURNING shows.
- recalculate_user_badges: idempotent badge re-check, a safety net
  alongside the real-time signal in signals.py.
- recalculate_watch_streak: idempotent streak re-calculation from the
  full WatchState history, a safety net for streak.
- run_tvtime_import: resolves a staged TV Time export against TMDB and
  writes watch state. Off-request because a full export is ~1,100
  sequential TMDB calls.
"""

import logging
from datetime import date, timedelta
from datetime import timezone as dt_timezone

from celery import shared_task
from django.db.models import Count, F
from django.utils import timezone
from django.utils.dateparse import parse_datetime

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
    CachedEpisode,
    CachedShow,
    ImportJob,
    MovieCache,
    MovieWatchlist,
    MovieWatchState,
    NotificationPreference,
    UserProfile,
    Watchlist,
    WatchState,
    WatchStreak,
)
from core.push_notifications import notify_users
from core.services import TMDBService, TMDBServiceError

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def refresh_show_cache(self, tmdb_id: int):
    """
    Re-syncs a show's metadata and every season it currently has cached.

    Also diffs episode rows before/after the refresh: any episode that
    didn't exist before this call and airs today is a genuinely "new
    episode" event, dispatched to notify_watchers_of_new_episodes() so
    push alerts go out to users tracking the show.
    """
    tmdb = TMDBService()
    try:
        show = tmdb.get_show_details(tmdb_id)
        cached_seasons = set(
            show.episodes.values_list("season_number", flat=True).distinct()
        )
        # Ensure we also fetch any new seasons announced on TMDB
        for s in range(1, show.total_seasons + 1):
            cached_seasons.add(s)

        existing_ids = set(show.episodes.values_list("tmdb_id", flat=True))

        for season_number in cached_seasons or {1}:
            tmdb.get_season_episodes(tmdb_id, season_number)

        today = timezone.now().date()
        newly_aired_ids = list(
            CachedEpisode.objects.filter(show=show, air_date=today)
            .exclude(tmdb_id__in=existing_ids)
            .values_list("tmdb_id", flat=True)
        )
        if newly_aired_ids:
            notify_watchers_of_new_episodes.delay(tmdb_id, newly_aired_ids)
    except TMDBServiceError as exc:
        logger.warning("refresh_show_cache failed for %s: %s", tmdb_id, exc)
        raise self.retry(exc=exc)


@shared_task
def notify_watchers_of_new_episodes(tmdb_id: int, episode_tmdb_ids: list):
    """
    Push "new episode" alerts to every user tracking this show (a
    non-archived Watchlist row) who has notify_new_episode enabled and
    a push token on file. Fired from refresh_show_cache when it detects
    episodes that just aired and weren't cached before.
    """
    try:
        show = CachedShow.objects.get(pk=tmdb_id)
    except CachedShow.DoesNotExist:
        return

    user_ids = list(
        Watchlist.objects.filter(show=show)
        .exclude(status=Watchlist.Status.ARCHIVED)
        .values_list("user_id", flat=True)
    )
    if not user_ids:
        return

    episodes = list(CachedEpisode.objects.filter(tmdb_id__in=episode_tmdb_ids).order_by("season_number", "episode_number"))
    if not episodes:
        return

    if len(episodes) == 1:
        ep = episodes[0]
        body = f"S{ep.season_number:02d}E{ep.episode_number:02d} – {ep.title}" if ep.title else f"S{ep.season_number:02d}E{ep.episode_number:02d} is out now"
    else:
        body = f"{len(episodes)} new episodes are out now"

    notify_users(
        user_ids,
        title=f"{show.title}: new episode",
        body=body,
        data={"type": "new_episode", "show_id": tmdb_id},
        preference_field="notify_new_episode",
    )
    logger.info("notify_watchers_of_new_episodes: show %s -> %d watcher(s) considered", tmdb_id, len(user_ids))


@shared_task
def send_weekly_digest():
    """
    Weekly push summarizing a user's activity, sent to everyone with
    notify_weekly_digest enabled and a push token on file. Wired to
    Celery beat (CELERY_BEAT_SCHEDULE) rather than called directly.
    """
    week_ago = timezone.now() - timedelta(days=7)
    prefs = NotificationPreference.objects.filter(
        notify_weekly_digest=True, push_token__isnull=False
    ).exclude(push_token="").select_related("user")

    for pref in prefs:
        episodes_watched = WatchState.objects.filter(
            user_id=pref.user_id, watched_at__gte=week_ago
        ).count()
        if episodes_watched == 0:
            continue  # nothing to report; don't nag an inactive user weekly

        body = f"You watched {episodes_watched} episode{'s' if episodes_watched != 1 else ''} this week. Keep it up!"
        notify_users(
            [pref.user_id],
            title="Your weekly recap",
            body=body,
            data={"type": "weekly_digest"},
        )
    logger.info("send_weekly_digest: considered %d user(s) with digest enabled", prefs.count())


@shared_task
def sync_active_shows():
    """
    Periodic sweep (wire up via Celery beat) that keeps RETURNING
    shows fresh so upcoming-episode countdowns stay accurate without
    every user's app triggering a live TMDB call on open.
    """
    active_ids = list(
        CachedShow.objects.filter(status=CachedShow.Status.RETURNING).values_list(
            "tmdb_id", flat=True
        )
    )
    for tmdb_id in active_ids:
        refresh_show_cache.delay(tmdb_id)
    logger.info("Queued refresh for %d active shows.", len(active_ids))


@shared_task
def recalculate_user_badges(user_id: int):
    """
    Idempotent safety-net re-check of milestone badges for one user.
    signals.py already awards badges in real time; this exists to
    catch anything missed by a failed signal (e.g. a worker restart
    mid-transaction) without ever double-awarding.
    """
    try:
        profile = UserProfile.objects.get(user_id=user_id)
    except UserProfile.DoesNotExist:
        logger.warning("recalculate_user_badges: no profile for user_id=%s", user_id)
        return

    newly_earned = []
    total_watched = WatchState.objects.filter(user_id=user_id).count()

    # ── Episode counts ────────────────────────────────────────────────
    if total_watched > 0 and BADGE_FIRST_EPISODE not in profile.earned_badges:
        newly_earned.append(BADGE_FIRST_EPISODE)

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

    # ── Time ──────────────────────────────────────────────────────────
    if (
        profile.total_time_watched >= TIME_TITAN_MINUTES
        and BADGE_TIME_TITAN not in profile.earned_badges
    ):
        newly_earned.append(BADGE_TIME_TITAN)

    # ── Binge / series ───────────────────────────────────────────────
    per_show_counts = (
        WatchState.objects.filter(user_id=user_id)
        .values("episode__show_id")
        .annotate(watched_count=Count("id"))
    )
    has_binge = any(row["watched_count"] >= BINGE_MASTER_THRESHOLD for row in per_show_counts)
    if has_binge and BADGE_BINGE_MASTER not in profile.earned_badges:
        newly_earned.append(BADGE_BINGE_MASTER)

    from core.models import Watchlist
    watchlist_count = Watchlist.objects.filter(user_id=user_id).count()
    if watchlist_count >= SERIES_ADDICT_THRESHOLD and BADGE_SERIES_ADDICT not in profile.earned_badges:
        newly_earned.append(BADGE_SERIES_ADDICT)
    if watchlist_count >= HUNDRED_SHOWS_THRESHOLD and BADGE_HUNDRED_SHOWS not in profile.earned_badges:
        newly_earned.append(BADGE_HUNDRED_SHOWS)

    # ── Movies ────────────────────────────────────────────────────────
    movies_watched = MovieWatchState.objects.filter(user_id=user_id).count()
    if movies_watched >= MOVIE_LOVER_THRESHOLD and BADGE_MOVIE_LOVER not in profile.earned_badges:
        newly_earned.append(BADGE_MOVIE_LOVER)

    # ── Genre badges ─────────────────────────────────────────────────
    show_genre_map: dict[str, set] = {}
    genre_set: set[str] = set()
    for row in (
        WatchState.objects.filter(user_id=user_id)
        .values("episode__show__tmdb_id", "episode__show__genres")
        .distinct()
    ):
        sid = row["episode__show__tmdb_id"]
        for g in (row["episode__show__genres"] or []):
            genre_set.add(g)
            show_genre_map.setdefault(g, set()).add(sid)

    if len(genre_set) >= GENRE_COLLECTOR_THRESHOLD and BADGE_GENRE_COLLECTOR not in profile.earned_badges:
        newly_earned.append(BADGE_GENRE_COLLECTOR)

    def _gc(genres):
        return max((len(show_genre_map.get(g, set())) for g in genres), default=0)

    if _gc(ANIME_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_ANIME_FAN not in profile.earned_badges:
        newly_earned.append(BADGE_ANIME_FAN)
    if _gc(SCI_FI_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_SCI_FI_GURU not in profile.earned_badges:
        newly_earned.append(BADGE_SCI_FI_GURU)
    if _gc(HORROR_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_HORROR_LOVER not in profile.earned_badges:
        newly_earned.append(BADGE_HORROR_LOVER)
    if _gc(COMEDY_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_COMEDY_KING not in profile.earned_badges:
        newly_earned.append(BADGE_COMEDY_KING)
    if _gc(DOCUMENTARY_GENRES) >= GENRE_FAN_THRESHOLD and BADGE_DOCUMENTARY_BUFF not in profile.earned_badges:
        newly_earned.append(BADGE_DOCUMENTARY_BUFF)

    # ── Streak badges (read from WatchStreak) ────────────────────────
    try:
        streak = WatchStreak.objects.get(user_id=user_id)
        if streak.longest_streak >= 7 and BADGE_DAILY_STREAK_7 not in profile.earned_badges:
            newly_earned.append(BADGE_DAILY_STREAK_7)
        if streak.longest_streak >= 28 and BADGE_WEEKLY_STREAK_4 not in profile.earned_badges:
            newly_earned.append(BADGE_WEEKLY_STREAK_4)
        if streak.longest_streak >= 90 and BADGE_MONTHLY_STREAK_3 not in profile.earned_badges:
            newly_earned.append(BADGE_MONTHLY_STREAK_3)
    except WatchStreak.DoesNotExist:
        pass

    if newly_earned:
        profile.earned_badges = [*profile.earned_badges, *newly_earned]
        profile.save(update_fields=["earned_badges"])
        logger.info("recalculate_user_badges: user %s earned %s", user_id, newly_earned)


@shared_task
def recalculate_watch_streak(user_id: int):
    """
    Idempotent full-history streak recalculation for a user. Recomputes
    current_streak, longest_streak, and total_streak_days from the raw
    WatchState watched_at dates — a safety net alongside the real-time
    signal update in signals.py.

    This is O(n) in the user's watch history, but runs in a Celery worker
    so it doesn't block any request cycle. Safe to run repeatedly; always
    converges to the correct value.
    """
    # Fetch all distinct dates the user watched at least one episode
    dates_qs = (
        WatchState.objects.filter(user_id=user_id)
        .values_list("watched_at__date", flat=True)
        .order_by("watched_at__date")
        .distinct()
    )
    dates: list[date] = [d for d in dates_qs if d is not None]

    if not dates:
        return  # No watches; leave streak at defaults (0)

    total_streak_days = len(dates)
    longest = 1
    current = 1

    for i in range(1, len(dates)):
        if dates[i] == dates[i - 1] + timedelta(days=1):
            current += 1
            longest = max(longest, current)
        else:
            current = 1

    # current_streak = trailing consecutive days up to today / last watch date
    today = date.today()
    last_watch = dates[-1]
    if last_watch < today - timedelta(days=1):
        # The streak is broken (last watch was before yesterday)
        current_streak = 0
    else:
        # Recount from the end of the date list
        current_streak = 1
        for i in range(len(dates) - 1, 0, -1):
            if dates[i] == dates[i - 1] + timedelta(days=1):
                current_streak += 1
            else:
                break

    streak, _ = WatchStreak.objects.get_or_create(user_id=user_id)
    streak.current_streak = current_streak
    streak.longest_streak = max(longest, streak.longest_streak)  # never decrease
    streak.total_streak_days = total_streak_days
    streak.last_watch_date = last_watch
    streak.save(update_fields=[
        "current_streak", "longest_streak", "total_streak_days", "last_watch_date", "updated_at"
    ])
    logger.info(
        "recalculate_watch_streak: user %s → current=%d, longest=%d, total=%d",
        user_id, current_streak, longest, total_streak_days,
    )

# ──────────────────────────────────────────────────────────────────────
# TV Time import
# ──────────────────────────────────────────────────────────────────────

# An export with hundreds of unresolvable titles shouldn't write an
# unbounded blob to the job row; the client only renders a few anyway.
IMPORT_ERROR_CAP = 50


def _parse_watched_at(raw):
    """
    TV Time stamps watched_at as ISO-8601 Zulu ("2021-11-22T05:06:18Z").
    Returns an aware datetime, or None if absent/unparseable — callers
    fall back to the model default (now) rather than dropping the row.
    """
    if not raw:
        return None
    try:
        parsed = parse_datetime(raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, dt_timezone.utc)
    return parsed


def _resolve_show_tmdb_id(tmdb: TMDBService, item: dict):
    """
    Map a TV Time series entry onto a TMDB show id.

    Series exports carry id.tvdb and a null id.imdb, so tvdb_id is the
    only real handle — title search is a last resort, since TMDB's first
    result for an ambiguous title ("The Office (US)") is a coin flip.
    /find/ answers in several buckets; only tv_results is a show. A tvdb
    *episode* id also resolves here, into tv_episode_results, so reading
    the wrong bucket would import an episode as a series.
    """
    tvdb_id = item.get("tvdb_id")
    if tvdb_id:
        try:
            results = tmdb.find_by_external_id(str(tvdb_id), "tvdb_id").get("tv_results") or []
            if results:
                return results[0]["id"]
        except TMDBServiceError:
            pass

    imdb_id = item.get("imdb_id")
    if imdb_id:
        try:
            results = tmdb.find_by_external_id(str(imdb_id), "imdb_id").get("tv_results") or []
            if results:
                return results[0]["id"]
        except TMDBServiceError:
            pass

    title = (item.get("title") or "").strip()
    if title:
        try:
            results = tmdb.search_shows(title).get("results") or []
            if results:
                return results[0]["tmdb_id"]
        except TMDBServiceError:
            pass
    return None


def _resolve_movie_tmdb_id(tmdb: TMDBService, item: dict):
    """
    Map a TV Time movie entry onto a TMDB movie id, via imdb_id only.

    The movies export's id.tvdb is a TV Time-internal number, NOT a real
    TVDB id — verified against live TMDB: tvdb_id=62 ("Thor: Ragnarok"
    in the export) resolves to the Buffy episode "Beer Bad", and
    tvdb_id=8 ("Avengers: Infinity War") to "Angel". Feeding it to /find/
    returns confidently wrong rows instead of erroring, so this never
    touches it. Every movie in the export has a real imdb_id.
    """
    imdb_id = item.get("imdb_id")
    if imdb_id:
        try:
            results = tmdb.find_by_external_id(str(imdb_id), "imdb_id").get("movie_results") or []
            if results:
                return results[0]["id"]
        except TMDBServiceError:
            pass

    title = (item.get("title") or "").strip()
    if title:
        try:
            results = [
                r for r in (tmdb.search_multi(title).get("results") or [])
                if r.get("media_type") == "movie"
            ]
            if results:
                return results[0]["tmdb_id"]
        except TMDBServiceError:
            pass
    return None


def _import_one_show(tmdb: TMDBService, user, item: dict, errors: list):
    """
    Returns (imported, episodes_marked, runtime_minutes_added).
    """
    title = (item.get("title") or "").strip() or "(untitled)"

    tmdb_id = _resolve_show_tmdb_id(tmdb, item)
    if tmdb_id is None:
        if len(errors) < IMPORT_ERROR_CAP:
            errors.append(f"Show not found on TMDB: '{title}'")
        return False, 0, 0

    cached_show = tmdb.get_show_details(tmdb_id)
    Watchlist.objects.get_or_create(
        user=user, show=cached_show, defaults={"status": Watchlist.Status.TO_WATCH}
    )

    # Collect watched (season, episode) -> watched_at up front so we only
    # fetch seasons that actually contain something to mark. Season 0 is
    # skipped: TVDB and TMDB disagree most on specials numbering, and the
    # export's specials are all unwatched anyway.
    wanted = {}
    for season_obj in item.get("seasons") or []:
        season_num = season_obj.get("season_number")
        if season_num is None or season_num == 0:
            continue
        for ep_obj in season_obj.get("episodes") or []:
            if not ep_obj.get("is_watched"):
                continue
            ep_num = ep_obj.get("episode_number")
            if ep_num is None:
                continue
            wanted[(season_num, ep_num)] = _parse_watched_at(ep_obj.get("watched_at"))

    if not wanted:
        return True, 0, 0

    season_numbers = {s for s, _ in wanted}
    for season_num in sorted(season_numbers):
        try:
            tmdb.get_season_episodes(tmdb_id, season_num)
        except TMDBServiceError:
            if len(errors) < IMPORT_ERROR_CAP:
                errors.append(f"Could not fetch '{title}' season {season_num}")

    episodes = {
        (e.season_number, e.episode_number): e
        for e in CachedEpisode.objects.filter(
            show=cached_show, season_number__in=season_numbers
        )
    }
    already = set(
        WatchState.objects.filter(user=user, episode__show=cached_show).values_list(
            "episode_id", flat=True
        )
    )

    today = timezone.now().date()
    rows = []
    runtime = 0
    for key, watched_at in wanted.items():
        episode = episodes.get(key)
        if episode is None or episode.tmdb_id in already:
            continue
        # A future air date against a watched episode means TVDB/TMDB
        # numbering diverged for this show — importing it would attach
        # real history to the wrong episode. air_date=None is allowed:
        # TMDB simply hasn't dated many older episodes, and dropping
        # those would silently lose genuine history.
        if episode.air_date is not None and episode.air_date > today:
            continue
        row = WatchState(user=user, episode=episode)
        if watched_at:
            row.watched_at = watched_at
        rows.append(row)
        runtime += episode.runtime_minutes or 0

    if rows:
        WatchState.objects.bulk_create(rows, batch_size=500, ignore_conflicts=True)
    return True, len(rows), runtime


def _import_one_movie(tmdb: TMDBService, user, item: dict, errors: list):
    """
    Returns (imported, runtime_minutes_added).
    """
    title = (item.get("title") or "").strip() or "(untitled)"

    tmdb_id = _resolve_movie_tmdb_id(tmdb, item)
    if tmdb_id is None:
        if len(errors) < IMPORT_ERROR_CAP:
            errors.append(f"Movie not found on TMDB: '{title}'")
        return False, 0

    cached_movie = tmdb.get_movie_details(tmdb_id)
    MovieWatchlist.objects.get_or_create(user=user, movie=cached_movie)

    if not item.get("is_watched"):
        return True, 0

    watched_at = _parse_watched_at(item.get("watched_at"))
    _, created = MovieWatchState.objects.get_or_create(
        user=user,
        movie=cached_movie,
        defaults={"watched_at": watched_at} if watched_at else {},
    )
    return True, (cached_movie.runtime_minutes or 0) if created else 0


@shared_task(bind=True)
def run_tvtime_import(self, job_id: str):
    """
    Resolve a staged TV Time export against TMDB and write watch state.

    Runs here rather than in the request because a full 200-series export
    is ~1,100 sequential TMDB round-trips (find + details + one per
    season) — minutes, not seconds. The DB writes are incidental; the
    HTTP calls are the entire cost, which is why bulk_create alone would
    not have kept this inside a request.

    bulk_create deliberately bypasses WatchState's post_save badge/streak
    signals — firing them thousands of times would be pathological. Both
    idempotent recalculation tasks run once at the end instead, and
    total_time_watched is incremented directly, mirroring the F() pattern
    WatchStateToggleView already uses.
    """
    try:
        job = ImportJob.objects.get(pk=job_id)
    except ImportJob.DoesNotExist:
        logger.warning("run_tvtime_import: job %s vanished before start", job_id)
        return

    payload = job.payload or {}
    shows = payload.get("shows") or []
    movies = payload.get("movies") or []

    job.status = ImportJob.Status.RUNNING
    job.total = len(shows) + len(movies)
    job.processed = 0
    job.save(update_fields=["status", "total", "processed"])

    tmdb = TMDBService()
    user = job.user
    errors = []
    episodes_marked = 0
    runtime_added = 0
    processed = 0

    try:
        for item in shows:
            try:
                imported, marked, runtime = _import_one_show(tmdb, user, item, errors)
                if imported:
                    job.shows_imported += 1
                    episodes_marked += marked
                    runtime_added += runtime
                else:
                    job.shows_skipped += 1
            except Exception as exc:  # one bad show must not kill the run
                logger.exception("run_tvtime_import: show failed")
                if len(errors) < IMPORT_ERROR_CAP:
                    errors.append(f"Error importing show '{item.get('title')}': {exc}")
                job.shows_skipped += 1
            processed += 1
            job.processed = processed
            job.save(update_fields=["processed", "shows_imported", "shows_skipped"])

        for item in movies:
            try:
                imported, runtime = _import_one_movie(tmdb, user, item, errors)
                if imported:
                    job.movies_imported += 1
                    runtime_added += runtime
                else:
                    job.movies_skipped += 1
            except Exception as exc:
                logger.exception("run_tvtime_import: movie failed")
                if len(errors) < IMPORT_ERROR_CAP:
                    errors.append(f"Error importing movie '{item.get('title')}': {exc}")
                job.movies_skipped += 1
            processed += 1
            job.processed = processed
            job.save(update_fields=["processed", "movies_imported", "movies_skipped"])

        if runtime_added:
            UserProfile.objects.filter(user=user).update(
                total_time_watched=F("total_time_watched") + runtime_added
            )

        # bulk_create skipped every post_save badge/streak signal; these
        # two idempotent tasks are the documented safety net for exactly
        # this. Run inline — we are already off the request path.
        recalculate_user_badges(user.id)
        recalculate_watch_streak(user.id)

        job.status = ImportJob.Status.SUCCESS
    except Exception as exc:
        logger.exception("run_tvtime_import: job %s failed", job_id)
        job.status = ImportJob.Status.FAILED
        job.detail = str(exc)

    job.episodes_marked = episodes_marked
    job.errors = errors
    job.finished_at = timezone.now()
    job.payload = {}  # staged input is dead weight once the run is over
    job.save()
    logger.info(
        "run_tvtime_import: job %s %s - %d shows, %d movies, %d episodes marked",
        job_id, job.status, job.shows_imported, job.movies_imported, episodes_marked,
    )
