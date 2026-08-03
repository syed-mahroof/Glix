"""
backend/core/views.py

JWT-protected DRF endpoints. Query patterns favor a small number of
well-indexed round trips (annotate/prefetch) over N+1 loops, since the
whole point of the local cache tables is to keep the hot mobile paths
fast and TMDB-rate-limit-free.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.db.models import Count, F, Max, OuterRef, Prefetch, Q, Subquery
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import (
    CachedEpisode,
    CachedShow,
    EpisodeInteraction,
    ImportJob,
    MovieCache,
    MovieWatchlist,
    MovieWatchState,
    RewatchEpisodeState,
    ShowRewatch,
    UserProfile,
    Watchlist,
    WatchState,
    NotificationPreference,
)
from core.cache_keys import CACHE_TTL_SECONDS, movie_watchlist_cache_key, watchlist_cache_key
from core.dates import has_released
from core.pagination import StandardResultsPagination
from core.serializers import (
    LEAN_EPISODE_FIELDS,
    ContinueWatchingSerializer,
    EpisodeInteractionSerializer,
    ImportJobSerializer,
    MovieCacheSerializer,
    MovieWatchlistSerializer,
    WatchlistSerializer,
    NotificationPreferenceSerializer,
    WatchHistorySerializer,
)
from core.services import ANIME_GENRE_ID, ANIME_ORIGINAL_LANGUAGE, TMDBService, TMDBServiceError
from core.tasks import recalculate_user_badges, recalculate_watch_streak, run_tvtime_import

class HealthCheckView(APIView):
    """
    GET /api/v1/health/

    Unauthenticated, no database or TMDB access — deliberately the cheapest
    possible response so the mobile client can fire it at launch to wake a
    sleeping free-tier dyno while the splash screen is still up, and so a
    connectivity failure can be distinguished from a slow-but-alive server.
    """

    permission_classes = [AllowAny]
    authentication_classes: list = []
    # No throttle: the client's own warmup loop (lib/warmup.ts) polls this
    # repeatedly while waiting out a cold Render boot, by design — the
    # default anon throttle (20/min) exists to protect real endpoints, not
    # to rate-limit the one endpoint whose entire job is being hit often.
    throttle_classes: list = []

    def get(self, request):
        return Response({"status": "ok"})


class DiscoverFeedView(APIView):
    """
    GET /api/discover/feed/?type=tv|movie  (default: tv)

    Returns a typed, sectioned payload for the Discover Hub.
    Response shape:
      {
        "type": "tv" | "movie",
        "hero": [ ...MediaItem ],       # backdrop-rich items for the hero carousel
        "sections": [
          { "id": str, "title": str, "items": [ ...MediaItem ] },
          ...
        ]
      }

    Minimises frontend network requests by bundling the hero + 3 content
    sections into a single response.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        media_type = request.query_params.get("type", "tv").lower()
        if media_type not in ("tv", "movie"):
            media_type = "tv"

        tmdb = TMDBService()

        if media_type == "tv":
            # These three TMDB calls are independent of each other but were
            # run sequentially, so a cold cache (see services.py's use_cache
            # TTLs) paid the sum of all three request+retry latencies on a
            # single Discover Feed load. None of them depend on another's
            # result, so running them on a small thread pool caps this
            # request's TMDB-bound latency at the slowest single call.
            with ThreadPoolExecutor(max_workers=3) as pool:
                trending_future = pool.submit(tmdb.get_trending_shows, time_window="week")
                popular_future = pool.submit(tmdb.get_popular_shows)
                airing_future = pool.submit(tmdb.get_airing_today_shows)
                trending = trending_future.result()
                popular = popular_future.result()
                airing = airing_future.result()

            # Hero: first 8 trending with backdrop images
            hero = [
                item for item in trending.get("results", [])
                if item.get("backdrop_path")
            ][:8]

            sections = [
                {
                    "id": "trending_shows",
                    "title": "Trending This Week",
                    "items": trending.get("results", [])[:15],
                },
                {
                    "id": "airing_today",
                    "title": "Airing Today",
                    "items": airing.get("results", [])[:15],
                },
                {
                    "id": "popular_shows",
                    "title": "Popular Shows",
                    "items": popular.get("results", [])[:15],
                },
            ]
        else:  # movie
            # Same reasoning as the tv branch above — 4 independent TMDB
            # calls bundled into one response, run concurrently instead of
            # sequentially.
            with ThreadPoolExecutor(max_workers=4) as pool:
                trending_future = pool.submit(tmdb.get_trending, media_type="movie", time_window="week")
                popular_future = pool.submit(tmdb.get_popular_movies)
                top_rated_future = pool.submit(tmdb.get_top_rated_movies)
                coming_soon_future = pool.submit(tmdb.get_anticipated_movies)
                trending = trending_future.result()
                popular = popular_future.result()
                top_rated = top_rated_future.result()
                coming_soon = coming_soon_future.result()

            # Trending results from the 'all' endpoint include backdrop_path
            hero = [
                item for item in trending.get("results", [])
                if item.get("backdrop_path")
            ][:8]

            sections = [
                {
                    "id": "trending_movies",
                    "title": "Trending This Week",
                    "items": trending.get("results", [])[:15],
                },
                {
                    "id": "popular_movies",
                    "title": "Popular Movies",
                    "items": popular.get("results", [])[:15],
                },
                {
                    "id": "top_rated_movies",
                    "title": "Top Rated",
                    "items": top_rated.get("results", [])[:15],
                },
                {
                    "id": "coming_soon",
                    "title": "Coming Soon",
                    "items": coming_soon.get("results", [])[:15],
                },
            ]

        return Response({
            "type": media_type,
            "hero": hero,
            "sections": sections,
        })


class DiscoverFilterView(APIView):
    """
    GET /api/discover/filter/?type=tv|movie&genre=<tmdb_genre_id>&sort=trending|popular|top_rated|critically_acclaimed&language=<iso_639_1>&anime=true|false&page=<int>

    Backs the Discover Hub's "Filter & Sort" bottom sheet. DiscoverFeedView
    returns a fixed set of curated sections with no genre/sort awareness —
    this hits TMDB's actual /discover/{tv|movie} endpoint (the one that
    supports with_genres/sort_by/with_original_language) for every sort
    except Trending.

    "Trending" is handled separately: TMDB's /trending endpoint doesn't
    accept with_genres or with_original_language at all (a TMDB API
    limitation), so instead of silently degrading "Trending + Genre" (or
    "+ Language"/"+ Anime") to a plain popularity sort, this fetches real
    trending results (with genre_ids/original_language attached) and
    filters in Python.

    `anime=true` ANDs TMDB's Animation genre onto `genre` and forces the
    language to Japanese (see TMDBService.discover_tv's `require_anime`
    docstring for why a conflicting `language` param is overridden rather
    than honored) — same heuristic as client-mobile/lib/anime.ts and the
    My Shows/My Movies Anime filter (Phase H), not a second definition.

    Response shape matches UniversalSearchResponse (page/total_pages/
    total_results/results) so the frontend reuses the same grid rendering
    as universal search — no new response shape to consume.
    """

    permission_classes = [IsAuthenticated]

    SORT_TO_TMDB = {
        "popular": "popularity.desc",
        "top_rated": "vote_average.desc",
        "critically_acclaimed": "vote_average.desc",
    }
    # "Top Rated" already guards against TMDB's single-10/10-vote quirk with
    # a 100-vote floor (TMDBService.discover_tv/movies' default). "Critically
    # Acclaimed" reuses the exact same anti-gaming mechanism, just with a
    # meaningfully higher floor — genuine broad consensus, not merely
    # "enough votes to clear the basic floor" — rather than a raw
    # vote_average sort a single vote could game (per the fix prompt).
    CRITICALLY_ACCLAIMED_MIN_VOTE_COUNT = 1000

    def get(self, request):
        media_type = request.query_params.get("type", "tv").lower()
        if media_type not in ("tv", "movie"):
            media_type = "tv"

        genre_param = request.query_params.get("genre")
        genre_id = int(genre_param) if genre_param and genre_param.isdigit() else None

        language = request.query_params.get("language") or None
        anime = request.query_params.get("anime", "").lower() in ("true", "1")
        if anime:
            # Same override reasoning as TMDBService.discover_tv's
            # require_anime: real anime is Japanese-language by this
            # heuristic, so a separately-picked language would just zero
            # out results rather than doing anything the caller likely meant.
            language = ANIME_ORIGINAL_LANGUAGE

        sort_key = request.query_params.get("sort", "trending")

        try:
            page = int(request.query_params.get("page", 1))
        except ValueError:
            page = 1

        tmdb = TMDBService()

        if sort_key == "trending":
            trending = tmdb.get_trending(
                media_type=media_type,
                time_window="week",
                page=page,
                include_genre_ids=True,
                include_original_language=True,
            )
            results = trending.get("results", [])
            if genre_id:
                results = [r for r in results if genre_id in (r.get("genre_ids") or [])]
            if anime:
                results = [
                    r
                    for r in results
                    if ANIME_GENRE_ID in (r.get("genre_ids") or [])
                    and r.get("original_language") == ANIME_ORIGINAL_LANGUAGE
                ]
            elif language:
                results = [r for r in results if r.get("original_language") == language]
            for r in results:
                r.pop("genre_ids", None)
                r.pop("original_language", None)

            is_filtered = bool(genre_id or anime or language)
            # TMDB's /trending endpoint has no with_genres/original_language
            # support, so this filtering happens page-by-page in Python
            # after the fact — there is no way to know the TRUE cross-page
            # total without fetching and filtering every one of TMDB's
            # pages up front. total_results is honest (this page's actual
            # count, which can legitimately be 0-3 after filtering); raw
            # trending total_pages, left uncapped, would let the client
            # "load more" dozens of times past the point where filtered
            # pages are reliably empty. Capped defensively when a filter is
            # active — not a real fix (that would need TMDB to support
            # server-side genre filtering on /trending, which it doesn't),
            # just a bound on how much wasted pagination this can cause.
            FILTERED_TRENDING_MAX_PAGES = 20
            data = {
                "page": trending.get("page", page),
                "total_pages": (
                    min(trending.get("total_pages", 1), FILTERED_TRENDING_MAX_PAGES)
                    if is_filtered
                    else trending.get("total_pages", 1)
                ),
                "total_results": len(results),
                "results": results,
            }
        else:
            sort_by = self.SORT_TO_TMDB.get(sort_key, "popularity.desc")
            min_vote_count = (
                self.CRITICALLY_ACCLAIMED_MIN_VOTE_COUNT if sort_key == "critically_acclaimed" else 100
            )
            discover_kwargs = dict(
                genre_id=genre_id,
                sort_by=sort_by,
                page=page,
                min_vote_count=min_vote_count,
                original_language=language,
                require_anime=anime,
            )
            if media_type == "tv":
                data = tmdb.discover_tv(**discover_kwargs)
            else:
                data = tmdb.discover_movies(**discover_kwargs)

        return Response(data, status=status.HTTP_200_OK)


class DiscoverGenresView(APIView):
    """
    GET /api/discover/genres/?type=tv|movie

    Returns each TMDB genre ID for the given media type paired with a real,
    currently-valid backdrop/poster image — the top popular title in that
    genre right now, via TMDBService.discover_tv()/discover_movies(). This
    replaces the frontend's previous approach of hand-typing a single TMDB
    image path per genre directly into GenreGrid.tsx, several of which had
    gone stale or were simply wrong (paths that 404, rendering as a blank
    card) — genre-cover images now can't go stale, they're fetched live.

    IDs mirror the same TV/movie genre lists the Filter & Sort sheet uses
    (client-mobile/lib/genres.ts) so tapping a genre card here and picking
    the same genre in the sheet hit the identical TMDB genre ID.

    Cached 24h per media_type: genre-cover images don't need to be fresher
    than that, and without caching this would fire ~16 TMDB requests
    (one discover call per genre) on every Discover Hub visit.
    """

    permission_classes = [IsAuthenticated]
    CACHE_TTL_SECONDS = 60 * 60 * 24

    TV_GENRE_IDS = [10759, 16, 35, 80, 99, 18, 10751, 10762, 9648, 10763, 10764, 10765, 10766, 10767, 10768, 37]
    MOVIE_GENRE_IDS = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53]

    def get(self, request):
        media_type = request.query_params.get("type", "tv").lower()
        if media_type not in ("tv", "movie"):
            media_type = "tv"

        cache_key = f"discover_genre_covers_{media_type}"
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

        tmdb = TMDBService()
        genre_ids = self.TV_GENRE_IDS if media_type == "tv" else self.MOVIE_GENRE_IDS

        # Was a sequential loop — 16 independent TMDB calls on a 24h cache
        # miss, blocking one of the app's 4 gunicorn threads for the sum of
        # all 16 instead of the slowest single one. Same ThreadPoolExecutor
        # pattern as DiscoverFeedView (:109) and get_popular_characters()
        # (services.py) — pool.map preserves genre_ids' order in its
        # results regardless of completion order.
        def _fetch_genre_cover(genre_id: int) -> dict:
            if media_type == "tv":
                data = tmdb.discover_tv(genre_id=genre_id, sort_by="popularity.desc", page=1)
            else:
                data = tmdb.discover_movies(genre_id=genre_id, sort_by="popularity.desc", page=1)
            top = data["results"][0] if data.get("results") else None
            return {
                "id": genre_id,
                "backdrop_path": top.get("backdrop_path") if top else None,
                "poster_path": top.get("poster_path") if top else None,
            }

        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(_fetch_genre_cover, genre_ids))

        cache.set(cache_key, results, timeout=self.CACHE_TTL_SECONDS)
        return Response(results, status=status.HTTP_200_OK)


class WatchlistView(APIView):
    """
    GET /api/watchlist/?page=<int>&page_size=<int>

    Returns the authenticated user's tracked shows split into three
    buckets: to_watch, up_to_date, archived. Each bucket is paginated
    independently via StandardResultsPagination (count/total_pages/
    current_page/next/previous/results), sharing the same page/
    page_size query params across all three buckets within a single
    request. ARCHIVED is whatever the user has manually set (see
    ArchiveToggleView); the other two are derived live from
    aired-vs-watched episode counts so a show flips into "Up To Date"
    the moment the user catches up, with no extra write needed.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Full-fetch responses are the expensive path (annotate+prefetch
        # across every tracked show's episodes/watch-states) and the one the
        # Shows Hub always requests — cached briefly per user; see
        # cache_keys.py and the signal-based invalidation in signals.py for
        # how this stays fresh without becoming a new response-shape contract.
        fetch_all = request.query_params.get("page_size") == "all"
        cache_key = watchlist_cache_key(request.user.id)
        if fetch_all:
            cached = cache.get(cache_key)
            if cached is not None:
                return Response(cached, status=status.HTTP_200_OK)

        today = timezone.now().date()

        entries = list(
            Watchlist.objects.filter(user=request.user)
            .select_related("show")
            .order_by("-updated_at")
        )

        # Episodes for the whole response in two flat queries, as plain
        # dicts — never as model instances.
        #
        # This replaced a Prefetch("show__episodes") that additionally
        # nested a per-episode Prefetch of that user's WatchState rows. For
        # a 400+ show / 12,000+ episode library that materialised ~25,000
        # Django model objects, then handed each one to a nested DRF
        # serializer, to produce a body whose episode entries the client
        # only ever reads seven fields from (LEAN_EPISODE_FIELDS). It was
        # the single heaviest endpoint in the app by a wide margin: minutes
        # of CPU and hundreds of MB of RSS on a free-tier container that
        # shares its 512MB with the celery worker, which is what surfaced
        # as gunicorn --timeout 60 kills (502 / "Can't reach Glix right
        # now") and Render "Instance failed" events. Two `values_list`
        # queries and a dict-building loop are O(episodes) with a tiny
        # constant instead.
        show_ids = [entry.show_id for entry in entries]

        # aired_count/watched_count/last_watched_at (Phase 75.8): two flat
        # grouped queries attached onto each entry in Python, not one
        # queryset annotated with Count(..., distinct=True) over two
        # different relations (show__episodes vs
        # show__episodes__watch_states) off the same Watchlist row — that
        # shape joins both relations before Postgres can dedupe, exploding
        # into aired-count × watched-count intermediate rows per show
        # before the DISTINCT collapses it back down. watched_count and
        # last_watched_at share the same WatchState join, so one grouped
        # query gives both together.
        aired_counts: dict[int, int] = {}
        watched_counts: dict[int, int] = {}
        last_watched_map: dict[int, object] = {}
        if show_ids:
            aired_counts = dict(
                CachedEpisode.objects.filter(show_id__in=show_ids, air_date__lte=today)
                .values("show_id")
                # CachedEpisode's primary key is `tmdb_id`, not `id` —
                # Count("id") raises FieldError on this model. Count("pk")
                # is PK-name-agnostic.
                .annotate(c=Count("pk"))
                .values_list("show_id", "c")
            )
            for row in (
                WatchState.objects.filter(user=request.user, episode__show_id__in=show_ids)
                .values("episode__show_id")
                .annotate(c=Count("id"), last=Max("watched_at"))
            ):
                watched_counts[row["episode__show_id"]] = row["c"]
                last_watched_map[row["episode__show_id"]] = row["last"]

        for entry in entries:
            entry.aired_count = aired_counts.get(entry.show_id, 0)
            entry.watched_count = watched_counts.get(entry.show_id, 0)
            entry.last_watched_at = last_watched_map.get(entry.show_id)

        episodes_by_show: dict[int, list] = {show_id: [] for show_id in show_ids}
        if show_ids:
            watched_episode_ids = set(
                WatchState.objects.filter(
                    user=request.user, episode__show_id__in=show_ids
                ).values_list("episode_id", flat=True)
            )
            episode_rows = (
                CachedEpisode.objects.filter(show_id__in=show_ids)
                .order_by("show_id", "season_number", "episode_number")
                .values_list(*LEAN_EPISODE_FIELDS)
            )
            for (
                tmdb_id,
                show_id,
                season_number,
                episode_number,
                title,
                air_date,
                air_datetime,
                runtime_minutes,
            ) in episode_rows.iterator(chunk_size=2000):
                episodes_by_show[show_id].append(
                    {
                        "tmdb_id": tmdb_id,
                        "show": show_id,
                        "season_number": season_number,
                        "episode_number": episode_number,
                        "title": title,
                        "air_date": air_date.isoformat() if air_date else None,
                        "air_datetime": air_datetime.isoformat() if air_datetime else None,
                        "runtime_minutes": runtime_minutes,
                        "is_watched": tmdb_id in watched_episode_ids,
                    }
                )

        # Active rewatch round per show, two flat queries — same technique
        # as episodes_by_show above, not a per-row query or a Prefetch (a
        # Prefetch here would instantiate a ShowRewatch + N RewatchEpisodeState
        # model objects per tracked show just to read two integers back out).
        active_rewatch_by_show: dict[int, dict] = {}
        if show_ids:
            active_rewatches = list(
                ShowRewatch.objects.filter(
                    user=request.user, show_id__in=show_ids, completed_at__isnull=True
                ).values("id", "show_id", "round_number")
            )
            if active_rewatches:
                rewatch_ids = [r["id"] for r in active_rewatches]
                watched_counts = dict(
                    RewatchEpisodeState.objects.filter(rewatch_id__in=rewatch_ids)
                    .values("rewatch_id")
                    .annotate(c=Count("id"))
                    .values_list("rewatch_id", "c")
                )
                for r in active_rewatches:
                    active_rewatch_by_show[r["show_id"]] = {
                        "round_number": r["round_number"],
                        "watched_episode_count": watched_counts.get(r["id"], 0),
                    }

        serializer_context = {
            "request": request,
            "episodes_by_show": episodes_by_show,
            "active_rewatch_by_show": active_rewatch_by_show,
        }

        buckets = {"to_watch": [], "up_to_date": [], "archived": []}

        for entry in entries:
            if entry.status == Watchlist.Status.ARCHIVED:
                bucket = "archived"
            elif entry.aired_count > 0 and entry.watched_count >= entry.aired_count:
                bucket = "up_to_date"
            else:
                bucket = "to_watch"
            buckets[bucket].append(entry)

        # `?page_size=all` returns every entry in one shot, unpaginated. The
        # client holds the full watchlist in memory and derives *everything*
        # from it — Profile's "My Shows" count, the Shows Hub buckets, the
        # Home/Upcoming tab, and the home-screen widget (see store's
        # syncWidgetData + lib/upcoming.ts). Page-paginating the buckets
        # silently capped all of those at one page (20/bucket): a 200-show
        # import showed "My Shows: 40" and upcoming/widget under-reported.
        # The shared page param across all three buckets also made page 2
        # 404 whenever any bucket had <2 pages, so the client could never
        # walk past page 1 anyway. Full DB work (the flat episode fetch
        # above) already happens regardless of pagination, so this mode
        # only adds serialization + payload — no extra queries.
        # (fetch_all itself is computed at the top of get(), alongside the
        # cache-hit check, so it's available before the expensive query runs.)

        paginated = {}
        for key, items in buckets.items():
            if fetch_all:
                paginated[key] = {
                    "count": len(items),
                    "total_pages": 1,
                    "current_page": 1,
                    "next": None,
                    "previous": None,
                    "results": WatchlistSerializer(
                        items, many=True, context=serializer_context
                    ).data,
                }
                continue

            paginator = StandardResultsPagination()
            page = paginator.paginate_queryset(items, request, view=self)
            serialized_results = WatchlistSerializer(
                page if page is not None else items,
                many=True,
                context=serializer_context,
            ).data

            if page is not None:
                paginated[key] = paginator.get_paginated_response(serialized_results).data
            else:
                paginated[key] = {
                    "count": len(items),
                    "total_pages": 1,
                    "current_page": 1,
                    "next": None,
                    "previous": None,
                    "results": serialized_results,
                }

        if fetch_all:
            cache.set(cache_key, paginated, timeout=CACHE_TTL_SECONDS)

        return Response(paginated, status=status.HTTP_200_OK)


class WatchStateToggleView(APIView):
    """
    POST /api/watch-state/toggle/
    Body: {"episode_id": <CachedEpisode.tmdb_id>}

    Atomically flips an episode's watched state. Existence of a
    WatchState row is the source of truth: if present, this deletes it
    and decrements total_time_watched; if absent, this creates it and
    increments total_time_watched. Both paths use F() expressions so
    concurrent toggles from the same user never race each other's
    read-modify-write on the profile row.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        episode_id = request.data.get("episode_id")
        if episode_id is None:
            return Response(
                {"detail": "episode_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        episode = get_object_or_404(CachedEpisode, pk=episode_id)

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(
                user=request.user
            )
            old_badges = list(profile.earned_badges)
            existing = WatchState.objects.filter(user=request.user, episode=episode).first()

            if existing is not None:
                existing.delete()
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") - episode.runtime_minutes
                )
                watched = False
            else:
                # Can't mark an episode watched before it has aired. Un-watching
                # (the branch above) is always allowed — this only gates the
                # "create WatchState" direction. air_date is null for episodes
                # TMDB hasn't dated yet; treat those as not-yet-airable too.
                today = timezone.now().date()
                if episode.air_date is None or episode.air_date > today:
                    return Response(
                        {"detail": "This episode hasn't aired yet — you can't mark it watched."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") + episode.runtime_minutes
                )
                profile.refresh_from_db(fields=["total_time_watched"])
                WatchState.objects.create(user=request.user, episode=episode)
                watched = True

            Watchlist.objects.get_or_create(
                user=request.user,
                show=episode.show,
                defaults={"status": Watchlist.Status.TO_WATCH},
            )

            profile.refresh_from_db(fields=["total_time_watched", "earned_badges"])
            if profile.total_time_watched < 0:
                UserProfile.objects.filter(pk=profile.pk).update(total_time_watched=0)
                profile.refresh_from_db(fields=["total_time_watched"])
                
            newly_earned_badges = [b for b in profile.earned_badges if b not in old_badges]

        return Response(
            {
                "episode_id": episode.tmdb_id,
                "watched": watched,
                "total_time_watched": profile.total_time_watched,
                "newly_earned_badges": newly_earned_badges,
            },
            status=status.HTTP_200_OK,
        )



class BulkWatchStateToggleView(APIView):
    """
    POST /api/watch-state/bulk-toggle/
    Body: {"episode_ids": [<int>, ...], "watched": true}

    Atomically marks multiple episodes as watched (or unwatched) in a
    single DB transaction. Designed for the "Cascade Catch-Up" feature
    where marking a later episode triggers marking all predecessors.

    Uses select_in_batch to avoid N+1 lookups, a single
    F()-expression UPDATE for total_time_watched, and a single
    bulk_create/bulk_delete for WatchState rows so the write count
    stays O(1) in DB round trips regardless of how many episodes are
    in the batch.

    bulk_create is signal-silent (Django never fires post_save for it),
    so the watched=True branch explicitly calls recalculate_user_badges/
    recalculate_watch_streak and busts the watchlist cache itself after
    the batch — mirroring how tasks.py's run_tvtime_import works around
    the exact same gap for its own bulk_create. Without this, a Cascade
    Catch-Up batch would earn no badges, not count toward the day's watch
    streak, and keep serving a stale cached watchlist.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        episode_ids = request.data.get("episode_ids")
        watched = request.data.get("watched", True)

        if not episode_ids or not isinstance(episode_ids, list):
            return Response(
                {"detail": "episode_ids must be a non-empty list."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        episodes = list(CachedEpisode.objects.filter(pk__in=episode_ids))
        if not episodes:
            return Response(
                {"detail": "No valid episodes found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(
                user=request.user
            )
            old_badges = list(profile.earned_badges)

            existing_states = set(
                WatchState.objects.filter(
                    user=request.user, episode__in=episodes
                ).values_list("episode_id", flat=True)
            )

            skipped_unaired_ids: list[int] = []
            applied_ids: list[int] = []

            if watched:
                # Only create states for episodes not yet watched AND already
                # aired — a Cascade Catch-Up must never mark a future episode
                # watched (same rule as the single-episode toggle). Unaired
                # ids in the batch are dropped from to_create, but — unlike
                # before — reported back explicitly via skipped_unaired_ids
                # rather than silently echoed as "successful" in episode_ids,
                # which let the client's optimistic state diverge from the
                # server with no error (AUDIT.md).
                to_create = [
                    ep
                    for ep in episodes
                    if ep.pk not in existing_states and has_released(ep.air_date)
                ]
                skipped_unaired_ids = [
                    ep.tmdb_id
                    for ep in episodes
                    if ep.pk not in existing_states and not has_released(ep.air_date)
                ]
                applied_ids = [ep.tmdb_id for ep in to_create]
                if to_create:
                    WatchState.objects.bulk_create(
                        [WatchState(user=request.user, episode=ep) for ep in to_create],
                        ignore_conflicts=True,
                    )
                    runtime_delta = sum(ep.runtime_minutes for ep in to_create)
                    UserProfile.objects.filter(pk=profile.pk).update(
                        total_time_watched=F("total_time_watched") + runtime_delta
                    )
                    # Auto-add to watchlist if not already tracked. One
                    # query for every show in the batch (in_bulk), not one
                    # CachedShow.objects.get() per distinct show — a Cascade
                    # Catch-Up spanning many shows turned this into an N+1
                    # (Phase 75.8).
                    show_ids = set(ep.show_id for ep in to_create)
                    shows_by_id = CachedShow.objects.in_bulk(show_ids)
                    for show_id in show_ids:
                        show = shows_by_id[show_id]
                        Watchlist.objects.get_or_create(
                            user=request.user,
                            show=show,
                            defaults={"status": Watchlist.Status.TO_WATCH},
                        )

                    # bulk_create deliberately does not fire WatchState's
                    # post_save signal (Django never sends signals for
                    # bulk_create — same reason run_tvtime_import documents
                    # in tasks.py), which means signals.py's evaluate_badges
                    # (badges + the day's watch-streak update) and its
                    # watchlist-cache-bust receiver both silently never run
                    # for a Cascade Catch-Up batch. Without this, marking a
                    # whole season watched at once earned no badges, never
                    # counted toward the streak for that day, and kept
                    # serving a stale `watchlist_all` cache for up to
                    # CACHE_TTL_SECONDS. Run the same two idempotent
                    # recalculation tasks run_tvtime_import calls after its
                    # own bulk_create, and bust the cache the same on_commit
                    # way signals.py's own receivers do.
                    recalculate_user_badges(request.user.id)
                    recalculate_watch_streak(request.user.id)
                    transaction.on_commit(lambda: cache.delete(watchlist_cache_key(request.user.id)))
            else:
                # Only delete states that currently exist
                to_delete = [ep for ep in episodes if ep.pk in existing_states]
                applied_ids = [ep.tmdb_id for ep in to_delete]
                if to_delete:
                    WatchState.objects.filter(
                        user=request.user, episode__in=to_delete
                    ).delete()
                    runtime_delta = sum(ep.runtime_minutes for ep in to_delete)
                    UserProfile.objects.filter(pk=profile.pk).update(
                        total_time_watched=F("total_time_watched") - runtime_delta
                    )

            profile.refresh_from_db(fields=["total_time_watched", "earned_badges"])
            if profile.total_time_watched < 0:
                UserProfile.objects.filter(pk=profile.pk).update(total_time_watched=0)
                profile.refresh_from_db(fields=["total_time_watched"])

            newly_earned_badges = [b for b in profile.earned_badges if b not in old_badges]

        return Response(
            {
                # Kept for backward compatibility — every requested id, not
                # just the ones actually applied. Prefer applied_episode_ids.
                "episode_ids": [ep.tmdb_id for ep in episodes],
                "applied_episode_ids": applied_ids,
                "skipped_unaired_ids": skipped_unaired_ids,
                "watched": watched,
                "total_time_watched": profile.total_time_watched,
                "newly_earned_badges": newly_earned_badges,
            },
            status=status.HTTP_200_OK,
        )


class EpisodeInteractionView(APIView):
    """
    POST /api/episode/interaction/
    Body: {
        "episode_id": <CachedEpisode.tmdb_id>,
        "emotion_emoji": "HAPPY",
        "mvp_character_id": 12345,
        "mvp_character_name": "Jesse Pinkman"
    }

    Upserts the user's single interaction row per episode so repeated
    voting updates in place instead of accumulating duplicates.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        episode_id = request.data.get("episode_id")
        if episode_id is None:
            return Response(
                {"detail": "episode_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        episode = get_object_or_404(CachedEpisode, pk=episode_id)

        update_fields = {}
        if "emotion_emoji" in request.data:
            update_fields["emotion_emoji"] = request.data.get("emotion_emoji", "")
        if "mvp_character_id" in request.data:
            update_fields["mvp_character_id"] = request.data.get("mvp_character_id")
        if "mvp_character_name" in request.data:
            update_fields["mvp_character_name"] = request.data.get("mvp_character_name", "")

        interaction, _ = EpisodeInteraction.objects.update_or_create(
            user=request.user,
            episode=episode,
            defaults=update_fields,
        )

        serializer = EpisodeInteractionSerializer(interaction)
        return Response(serializer.data, status=status.HTTP_200_OK)


class FavoriteToggleView(APIView):
    """
    POST /api/watchlist/favorite/
    Body: {"show_id": <CachedShow.tmdb_id>}

    Toggles Watchlist.is_favorite for the given show, auto-creating the
    Watchlist row (mirrors WatchStateToggleView's auto-add behavior) so
    favoriting a show from a show-detail screen works even if the user
    hasn't watched an episode of it yet.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        show_id = request.data.get("show_id")
        if show_id is None:
            return Response(
                {"detail": "show_id is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        show = get_object_or_404(CachedShow, pk=show_id)

        entry, created = Watchlist.objects.get_or_create(
            user=request.user,
            show=show,
            defaults={"status": Watchlist.Status.TO_WATCH, "is_favorite": True},
        )
        if not created:
            entry.is_favorite = not entry.is_favorite
            entry.save(update_fields=["is_favorite", "updated_at"])

        return Response(
            {"show_id": show.tmdb_id, "is_favorite": entry.is_favorite},
            status=status.HTTP_200_OK,
        )


class CatchupCheckView(APIView):
    """
    POST /api/watch-state/catchup-check/
    Body EITHER:
      {"episode_id": <CachedEpisode.tmdb_id>}                    — episode mode
      {"show_id": <CachedShow.tmdb_id>, "season_number": <int>}  — season mode

    Server-authoritative replacement for the old frontend-only
    watchStore.hasPreviousUnwatched()/hasPreviousUnwatchedForSeason(),
    which computed "does this show have earlier unwatched episodes?"
    purely from whatever the Zustand watchlist snapshot happened to
    already have cached client-side. That was silently incomplete
    whenever a user jumped straight to a later season without first
    opening the season(s) before it — those episodes were never fetched
    into the frontend's copy at all, so they were invisible to the check
    and the Catch-Up modal simply never fired (live-tested, user-
    reported bug — see AUDIT.md). This view eagerly fetches, via
    TMDBService and best-effort, any season strictly before the check
    boundary that isn't cached yet, so the answer is always computed
    from a complete picture rather than whatever the client already
    happened to have loaded — this is what makes "mark any episode, in
    any order, in any season" work correctly.

    Episode mode: "previous" = every episode chronologically earlier
    than the target (season < target's season, OR same season with a
    lower episode number) that isn't watched yet.
    Season mode (mirrors the old hasPreviousUnwatchedForSeason): earlier
    SEASONS only — the target season's own unwatched episodes are the
    caller's own responsibility (e.g. "Mark Season Watched" already
    marks its own season's episodes regardless of this check).

    Returns {"has": bool, "ids": [int...], "count": int}. Short-circuits
    to has:false without any of the above work if the show's
    Watchlist.ignore_catchup is set ("Never for this show").
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        episode_id = request.data.get("episode_id")
        show_id = request.data.get("show_id")
        season_number = request.data.get("season_number")

        if episode_id is not None:
            episode = get_object_or_404(CachedEpisode, pk=episode_id)
            show = episode.show
            target_season = episode.season_number
            target_episode_number = episode.episode_number
        elif show_id is not None and season_number is not None:
            show = get_object_or_404(CachedShow, pk=show_id)
            target_season = int(season_number)
            target_episode_number = None  # season mode: earlier seasons only
        else:
            return Response(
                {"detail": "Provide either episode_id, or show_id + season_number."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        entry = Watchlist.objects.filter(user=request.user, show=show).first()
        if entry is not None and entry.ignore_catchup:
            return Response({"has": False, "ids": [], "count": 0}, status=status.HTTP_200_OK)

        # Episode mode also needs the target's own season fully cached (it
        # already must be, since the target episode itself is a real
        # CachedEpisode row) plus every season before it; season mode only
        # needs everything strictly before the target season. Best-effort:
        # a TMDB failure here just means whatever's already cached is what
        # gets checked, same behavior as before this view existed.
        upper_bound = target_season if episode_id is not None else target_season - 1
        if upper_bound >= 1:
            cached_seasons = set(
                CachedEpisode.objects.filter(show=show, season_number__lte=upper_bound)
                .values_list("season_number", flat=True)
                .distinct()
            )
            tmdb = TMDBService()
            for s in range(1, upper_bound + 1):
                if s not in cached_seasons:
                    try:
                        tmdb.get_season_episodes(show.tmdb_id, s)
                    except TMDBServiceError:
                        pass

        watched_ids = WatchState.objects.filter(
            user=request.user, episode__show=show
        ).values_list("episode_id", flat=True)

        if episode_id is not None:
            prev_qs = CachedEpisode.objects.filter(show=show).filter(
                Q(season_number__lt=target_season)
                | Q(season_number=target_season, episode_number__lt=target_episode_number)
            )
        else:
            prev_qs = CachedEpisode.objects.filter(show=show, season_number__lt=target_season)

        # Only count episodes that have actually aired — bulk-toggle will
        # refuse to create WatchState rows for unaired ones (see
        # BulkWatchStateToggleView), so counting them here would let the
        # Catch-Up modal promise "N previous episodes" that the follow-up
        # bulk-toggle then silently can't deliver on.
        today = timezone.now().date()
        ids = list(
            prev_qs.exclude(pk__in=watched_ids)
            .filter(air_date__isnull=False, air_date__lte=today)
            .values_list("tmdb_id", flat=True)
        )

        return Response({"has": len(ids) > 0, "ids": ids, "count": len(ids)}, status=status.HTTP_200_OK)


class CatchupPreferenceView(APIView):
    """
    POST /api/watchlist/catchup-preference/
    Body: {"show_id": <CachedShow.tmdb_id>, "ignore_catchup": true|false}

    Backs the Catch-Up modal's "Never for this show" option. Sets
    Watchlist.ignore_catchup so future watch-toggles on this show skip
    the "mark previous episodes watched?" prompt and always behave as
    "just this one" — checked by CatchupCheckView (above) before the
    modal is ever shown. Auto-creates the Watchlist row if missing,
    mirroring FavoriteToggleView/ArchiveToggleView's auto-add behavior.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        show_id = request.data.get("show_id")
        ignore_catchup = request.data.get("ignore_catchup")
        if show_id is None or ignore_catchup is None:
            return Response(
                {"detail": "show_id and ignore_catchup are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        show = get_object_or_404(CachedShow, pk=show_id)
        entry, _ = Watchlist.objects.get_or_create(
            user=request.user, show=show, defaults={"status": Watchlist.Status.TO_WATCH}
        )
        entry.ignore_catchup = bool(ignore_catchup)
        entry.save(update_fields=["ignore_catchup", "updated_at"])

        return Response(
            {"show_id": show.tmdb_id, "ignore_catchup": entry.ignore_catchup},
            status=status.HTTP_200_OK,
        )


class ArchiveToggleView(APIView):
    """
    POST /api/watchlist/archive/
    Body: {"show_id": <CachedShow.tmdb_id>, "archived": true|false}

    Sets or clears Watchlist.status = ARCHIVED. Unarchiving resets
    status to TO_WATCH as a starting point; WatchlistView recomputes
    the real To-Watch/Up-To-Date bucket dynamically on the next fetch
    regardless, per its docstring above.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        show_id = request.data.get("show_id")
        archived = request.data.get("archived")
        if show_id is None or archived is None:
            return Response(
                {"detail": "show_id and archived are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        show = get_object_or_404(CachedShow, pk=show_id)
        entry, _ = Watchlist.objects.get_or_create(
            user=request.user, show=show, defaults={"status": Watchlist.Status.TO_WATCH}
        )
        entry.status = Watchlist.Status.ARCHIVED if archived else Watchlist.Status.TO_WATCH
        entry.save(update_fields=["status", "updated_at"])

        return Response(
            {"show_id": show.tmdb_id, "status": entry.status},
            status=status.HTTP_200_OK,
        )


class ShowAddView(APIView):
    """
    POST /api/watchlist/add/
    Body: {"show_id": <int>}

    Adds a show to the user's watchlist without touching any episode
    watch state — mirrors MovieAddView's pattern for the show side.
    Fetches show details from TMDB via the service layer (cache-first)
    so this works even if the CachedShow row doesn't exist yet.

    Also eagerly caches season 1 so the new entry has at least one
    episode row: buildRows() on the Shows Hub (frontend) skips any
    watchlist entry whose show has zero cached episodes, which would
    otherwise make a freshly-added show vanish from every filter pill
    until the user happened to open a season screen. Best-effort —
    if TMDB has no season 1 (or is unreachable), the add still
    succeeds, it just won't show a row until episodes are cached.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        show_id = request.data.get("show_id")
        if show_id is None:
            return Response(
                {"detail": "show_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from core.services import TMDBService, TMDBServiceError

        try:
            tmdb = TMDBService()
            show = tmdb.get_show_details(int(show_id))
        except (TMDBServiceError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        if show.total_seasons > 0:
            try:
                tmdb.get_season_episodes(show.tmdb_id, 1)
            except TMDBServiceError:
                pass

        entry, created = Watchlist.objects.get_or_create(
            user=request.user, show=show, defaults={"status": Watchlist.Status.TO_WATCH}
        )
        serializer = WatchlistSerializer(entry, context={"request": request})
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ShowRemoveView(APIView):
    """
    DELETE /api/watchlist/remove/
    Body: {"show_id": <CachedShow.tmdb_id>}

    Fully removes a show from the user's watchlist: deletes the
    Watchlist row AND every WatchState the user has for that show's
    episodes, decrementing total_time_watched by the same amount
    WatchStateToggleView would have on an equivalent series of
    individual un-watches (same F()-expression pattern, same
    non-negative floor). This is a genuine "undo the add" per product
    decision — episode marks made while the show was tracked are wiped
    too, not just hidden (Watchlist.status=ARCHIVED already covers the
    "hide but keep everything" case).

    earned_badges is deliberately left untouched — badges are additive
    only everywhere else in this codebase (WatchStateToggleView/
    BulkWatchStateToggleView never revoke a badge on an un-watch
    either), so a remove shouldn't behave differently.

    Returns exactly what was deleted so the frontend's Snackbar Undo
    can restore it precisely (re-add the show, re-mark these exact
    episode ids, restore favorite/status/ignore_catchup) regardless of
    how much of the show happened to be cached client-side — same
    "server is the source of truth for what to restore" reasoning as
    CatchupCheckView.
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request):
        show_id = request.data.get("show_id")
        if show_id is None:
            return Response(
                {"detail": "show_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        show = get_object_or_404(CachedShow, pk=show_id)
        entry = Watchlist.objects.filter(user=request.user, show=show).first()
        if entry is None:
            return Response(
                {"detail": "Show is not in your watchlist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(
                user=request.user
            )
            watch_states = list(
                WatchState.objects.filter(user=request.user, episode__show=show).select_related(
                    "episode"
                )
            )
            watched_episode_ids = [ws.episode.tmdb_id for ws in watch_states]
            runtime_total = sum(ws.episode.runtime_minutes for ws in watch_states)

            was_favorite = entry.is_favorite
            was_status = entry.status
            was_ignore_catchup = entry.ignore_catchup

            WatchState.objects.filter(user=request.user, episode__show=show).delete()
            entry.delete()

            if runtime_total:
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") - runtime_total
                )
                profile.refresh_from_db(fields=["total_time_watched"])
                if profile.total_time_watched < 0:
                    UserProfile.objects.filter(pk=profile.pk).update(total_time_watched=0)
                    profile.refresh_from_db(fields=["total_time_watched"])

        return Response(
            {
                "show_id": show.tmdb_id,
                "watched_episode_ids": watched_episode_ids,
                "was_favorite": was_favorite,
                "was_status": was_status,
                "was_ignore_catchup": was_ignore_catchup,
                "total_time_watched": profile.total_time_watched,
            },
            status=status.HTTP_200_OK,
        )


class ContinueWatchingView(APIView):
    """
    GET /api/continue-watching/

    Shows the user has started but not finished (at least one watched
    episode, at least one unwatched-but-aired episode remaining), each
    paired with the next unwatched aired episode, ordered by most
    recently watched. Capped at 10 — this is a "jump back in" rail,
    not a full list (use /api/watchlist/ for that). Archived shows are
    excluded.
    """

    permission_classes = [IsAuthenticated]
    RESULT_LIMIT = 10

    def get(self, request):
        today = timezone.now().date()

        # Which shows qualify ("started but not finished") and how they
        # rank, via two flat grouped queries (Phase 75.8) — not one
        # queryset annotated with two Count(..., distinct=True) over
        # different relations (show__episodes vs
        # show__episodes__watch_states) off the same Watchlist row; see
        # WatchlistView's identical fix for the full cartesian-join
        # reasoning. Cheap even across the user's whole active library:
        # this is show-level aggregation, not per-episode.
        show_ids = list(
            Watchlist.objects.filter(user=request.user)
            .exclude(status=Watchlist.Status.ARCHIVED)
            .values_list("show_id", flat=True)
        )

        aired_counts: dict[int, int] = {}
        watched_counts: dict[int, int] = {}
        last_watched_map: dict[int, object] = {}
        if show_ids:
            aired_counts = dict(
                CachedEpisode.objects.filter(show_id__in=show_ids, air_date__lte=today)
                .values("show_id")
                # CachedEpisode's primary key is `tmdb_id`, not `id` —
                # Count("id") raises FieldError on this model. Count("pk")
                # is PK-name-agnostic.
                .annotate(c=Count("pk"))
                .values_list("show_id", "c")
            )
            for row in (
                WatchState.objects.filter(user=request.user, episode__show_id__in=show_ids)
                .values("episode__show_id")
                .annotate(c=Count("id"), last=Max("watched_at"))
            ):
                watched_counts[row["episode__show_id"]] = row["c"]
                last_watched_map[row["episode__show_id"]] = row["last"]

        qualifying = [
            show_id
            for show_id in show_ids
            if watched_counts.get(show_id, 0) > 0
            and aired_counts.get(show_id, 0) > watched_counts.get(show_id, 0)
        ]
        qualifying.sort(key=lambda show_id: last_watched_map[show_id], reverse=True)
        top_show_ids = qualifying[: self.RESULT_LIMIT]

        # Episode/watch-state prefetch only runs for the (at most 10) shows
        # that actually made the cut, not the user's whole active library.
        watch_state_prefetch = Prefetch(
            "watch_states",
            queryset=WatchState.objects.filter(user=request.user),
            to_attr="prefetched_watch_states",
        )
        episode_prefetch = Prefetch(
            "show__episodes",
            queryset=CachedEpisode.objects.prefetch_related(watch_state_prefetch).order_by(
                "season_number", "episode_number"
            ),
        )
        entries_by_show = {
            entry.show_id: entry
            for entry in Watchlist.objects.filter(
                user=request.user, show_id__in=top_show_ids
            ).select_related("show").prefetch_related(episode_prefetch)
        }

        payload = []
        for show_id in top_show_ids:
            entry = entries_by_show.get(show_id)
            if entry is None:
                continue

            next_episode = None
            for episode in entry.show.episodes.all():
                if not episode.air_date or episode.air_date > today:
                    continue
                if not getattr(episode, "prefetched_watch_states", []):
                    next_episode = episode
                    break

            aired = aired_counts.get(show_id, 0)
            watched = watched_counts.get(show_id, 0)
            progress = round((watched / aired) * 100, 1) if aired else 0.0
            payload.append(
                {
                    "show": entry.show,
                    "next_episode": next_episode,
                    "watched_episode_count": watched,
                    "aired_episode_count": aired,
                    "progress_percentage": progress,
                    "last_watched_at": last_watched_map.get(show_id),
                }
            )

        serializer = ContinueWatchingSerializer(payload, many=True, context={"request": request})
        return Response(serializer.data, status=status.HTTP_200_OK)


class WatchHistoryView(generics.ListAPIView):
    """
    GET /api/watch-history/
    Returns a paginated, reverse-chronological list of the user's
    individual watched episodes. Used to power the Watch History ledger.
    """
    permission_classes = [IsAuthenticated]
    serializer_class = WatchHistorySerializer
    pagination_class = StandardResultsPagination

    def get_queryset(self):
        return WatchState.objects.filter(user=self.request.user).select_related(
            "episode", "episode__show"
        ).order_by("-watched_at")


class NotificationPreferenceView(APIView):
    """
    GET /api/notifications/preferences/
    PATCH /api/notifications/preferences/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(pref)
        return Response(serializer.data, status=status.HTTP_200_OK)

    def patch(self, request):
        pref, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(pref, data=request.data, partial=True)
        if serializer.is_valid():
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class MovieWatchlistView(APIView):
    """
    GET /api/movies/watchlist/

    Returns the authenticated user's tracked movies split into two buckets:
      - watch_next: movies in the watchlist that have NOT been watched yet
      - watched:    movies that have been marked as watched

    Each bucket is a flat list (no pagination for V1 — movie watchlists
    are typically far shorter than TV show watchlists).
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Cached per user like WatchlistView's page_size=all path — see
        # cache_keys.py and signals.py's invalidation receivers. This
        # endpoint is always a full unpaginated fetch, so no fetch_all gate.
        cache_key = movie_watchlist_cache_key(request.user.id)
        cached = cache.get(cache_key)
        if cached is not None:
            return Response(cached, status=status.HTTP_200_OK)

        # Powers the "Last Watched" pill (Movies Hub): when this movie was
        # actually marked watched, distinct from MovieWatchlist's own
        # -updated_at (bumped by any change to the tracking row, not just
        # the watch toggle). One Subquery, not N+1 — same technique
        # WatchlistView already uses for its own last_watched_at annotation.
        watched_at_subq = MovieWatchState.objects.filter(
            user=request.user, movie_id=OuterRef("movie_id")
        ).values("watched_at")[:1]

        entries = (
            MovieWatchlist.objects.filter(user=request.user)
            .select_related("movie")
            .annotate(
                watch_state_watched_at=Subquery(watched_at_subq),
                rewatch_count_annotated=Count(
                    "movie__rewatches", filter=Q(movie__rewatches__user=request.user), distinct=True
                ),
            )
            .order_by("-updated_at")
        )

        watched_ids = set(
            MovieWatchState.objects.filter(user=request.user)
            .values_list("movie_id", flat=True)
        )

        watch_next = []
        watched = []
        for entry in entries:
            if entry.movie_id in watched_ids:
                watched.append(entry)
            else:
                watch_next.append(entry)

        context = {"request": request}
        payload = {
            "watch_next": MovieWatchlistSerializer(watch_next, many=True, context=context).data,
            "watched": MovieWatchlistSerializer(watched, many=True, context=context).data,
        }
        cache.set(cache_key, payload, timeout=CACHE_TTL_SECONDS)
        return Response(payload, status=status.HTTP_200_OK)


class MovieWatchStateToggleView(APIView):
    """
    POST /api/movies/watch-state/toggle/
    Body: {"movie_id": <MovieCache.tmdb_id>}

    Atomically flips a movie's watched state. Existence of a
    MovieWatchState row is the source of truth: if present, this
    deletes it and decrements total_time_watched; if absent, this
    creates it and increments total_time_watched. Both paths use
    F() expressions so concurrent toggles never race each other's
    read-modify-write on the profile row.

    Also auto-creates a MovieWatchlist entry if the movie is not
    already tracked — mirrors WatchStateToggleView's Watchlist behaviour.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        movie_id = request.data.get("movie_id")
        if movie_id is None:
            return Response(
                {"detail": "movie_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        movie = get_object_or_404(MovieCache, pk=movie_id)

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(
                user=request.user
            )
            old_badges = list(profile.earned_badges)
            existing = MovieWatchState.objects.filter(
                user=request.user, movie=movie
            ).first()

            if existing is not None:
                existing.delete()
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") - movie.runtime_minutes
                )
                watched = False
            else:
                # Can't mark a movie watched before it's released. Un-watching
                # (the branch above) is always allowed — this only gates the
                # "create MovieWatchState" direction. release_date is null for
                # movies TMDB hasn't dated yet; treat those as not-yet-released
                # too. Mirrors WatchStateToggleView's identical episode gate.
                if not has_released(movie.release_date):
                    return Response(
                        {"detail": "This movie hasn't released yet — you can't mark it watched."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") + movie.runtime_minutes
                )
                profile.refresh_from_db(fields=["total_time_watched"])
                MovieWatchState.objects.create(user=request.user, movie=movie)
                watched = True

            # Auto-create watchlist entry so the movie appears in the hub
            MovieWatchlist.objects.get_or_create(user=request.user, movie=movie)

            profile.refresh_from_db(fields=["total_time_watched", "earned_badges"])
            if profile.total_time_watched < 0:
                UserProfile.objects.filter(pk=profile.pk).update(total_time_watched=0)
                profile.refresh_from_db(fields=["total_time_watched"])

            newly_earned_badges = [b for b in profile.earned_badges if b not in old_badges]

        return Response(
            {
                "movie_id": movie.tmdb_id,
                "watched": watched,
                "total_time_watched": profile.total_time_watched,
                "newly_earned_badges": newly_earned_badges,
            },
            status=status.HTTP_200_OK,
        )


class MovieAddView(APIView):
    """
    POST /api/movies/add/
    Body: {"movie_id": <int>}

    Adds a movie to the user's watchlist. Fetches movie details from
    TMDB via the service layer (using the same cache-first pattern as
    ShowDetailView) and creates a MovieWatchlist entry. Idempotent —
    re-adding a movie that is already tracked returns 200.
    """

    permission_classes = [IsAuthenticated]

    def post(self, request):
        movie_id = request.data.get("movie_id")
        if movie_id is None:
            return Response(
                {"detail": "movie_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from core.services import TMDBService, TMDBServiceError

        try:
            tmdb = TMDBService()
            movie = tmdb.get_movie_details(int(movie_id))
        except (TMDBServiceError, ValueError) as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_404_NOT_FOUND)

        entry, created = MovieWatchlist.objects.get_or_create(
            user=request.user, movie=movie
        )
        serializer = MovieWatchlistSerializer(entry, context={"request": request})
        return Response(
            serializer.data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MovieRemoveView(APIView):
    """
    DELETE /api/movies/watchlist/remove/
    Body: {"movie_id": <MovieCache.tmdb_id>}

    Mirrors ShowRemoveView for the movie side — MovieWatchlist carries
    no favorite/status/ignore_catchup fields, so the only thing worth
    returning for Undo besides the id is whether it was marked watched.
    """

    permission_classes = [IsAuthenticated]

    def delete(self, request):
        movie_id = request.data.get("movie_id")
        if movie_id is None:
            return Response(
                {"detail": "movie_id is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        movie = get_object_or_404(MovieCache, pk=movie_id)
        entry = MovieWatchlist.objects.filter(user=request.user, movie=movie).first()
        if entry is None:
            return Response(
                {"detail": "Movie is not in your watchlist."},
                status=status.HTTP_404_NOT_FOUND,
            )

        with transaction.atomic():
            profile, _ = UserProfile.objects.select_for_update().get_or_create(
                user=request.user
            )
            was_watched = MovieWatchState.objects.filter(
                user=request.user, movie=movie
            ).exists()
            runtime_total = movie.runtime_minutes if was_watched else 0

            MovieWatchState.objects.filter(user=request.user, movie=movie).delete()
            entry.delete()

            if runtime_total:
                UserProfile.objects.filter(pk=profile.pk).update(
                    total_time_watched=F("total_time_watched") - runtime_total
                )
                profile.refresh_from_db(fields=["total_time_watched"])
                if profile.total_time_watched < 0:
                    UserProfile.objects.filter(pk=profile.pk).update(total_time_watched=0)
                    profile.refresh_from_db(fields=["total_time_watched"])

        return Response(
            {
                "movie_id": movie.tmdb_id,
                "was_watched": was_watched,
                "total_time_watched": profile.total_time_watched,
            },
            status=status.HTTP_200_OK,
        )


def _sorted_import_payload(payload: dict) -> dict:
    """
    Normalises a submitted TV Time export's top-level ordering before
    comparing it against a resumable FAILED job's stored payload.

    Only the `shows`/`movies` array ORDER is normalised — every field
    (including per-episode watched flags/dates) is still compared as-is,
    so this cannot mask a genuine content difference (e.g. more episodes
    marked watched since the failed attempt still correctly fails to
    match and starts a fresh job). TV Time's export ordering isn't
    guaranteed stable across runs; without this, re-exporting the exact
    same watch history in a different row order silently fell through to
    a brand new job instead of resuming — safe (the diff-aware dedup in
    tasks.py still prevents duplicates either way) but threw away the
    resume optimization for no reason. Resuming itself always continues
    from the STORED job's own payload/cursor (see run_tvtime_import) —
    this function is only ever used for the equality check below, never
    as a data source, so it can't cause a resume to process the wrong
    item.
    """

    def show_key(s):
        return (str(s.get("tvdb_id") or ""), str(s.get("imdb_id") or ""), s.get("title") or "")

    def movie_key(m):
        return (str(m.get("tvdb_id") or ""), str(m.get("imdb_id") or ""), m.get("title") or "")

    return {
        "shows": sorted(payload.get("shows") or [], key=show_key),
        "movies": sorted(payload.get("movies") or [], key=movie_key),
    }


def _payload_fingerprint(payload: dict) -> str:
    """
    sha256 of the order-normalised payload — computed once per submission
    and stored on ImportJob.payload_fingerprint, so a later resubmission
    is checked with a cheap string comparison instead of pulling the
    stored job's full multi-MB `payload` JSONField out of Postgres and
    deep-comparing it again (what _sorted_import_payload's equality check
    used to cost on every single retry attempt).
    """
    import hashlib
    import json

    canonical = json.dumps(_sorted_import_payload(payload), sort_keys=True, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


class TVTimeImportView(APIView):
    """
    POST /api/import/tvtime/

    Stages a normalised TV Time export and hands it to a Celery worker,
    returning immediately with a job id. Resolving a full 200-series
    export takes ~1,100 sequential TMDB calls (minutes) — it cannot run
    inside the request, so this endpoint no longer reports a result.
    Poll ImportJobStatusView for progress and the final counts.

    The client (lib/migration.ts) normalises both key spellings the
    exports use in the wild: the real Refract export nests episode data
    under `number`, while some samples use `season_number`/
    `episode_number`. It also forwards both external ids — series
    entries carry only id.tvdb, movie entries only a usable id.imdb.

    Body:
    {
      "shows": [
        {
          "title": str,
          "tvdb_id": int | null,
          "imdb_id": str | null,
          "seasons": [
            {
              "season_number": int,
              "episodes": [
                {"episode_number": int, "is_watched": bool, "watched_at": str | null}
              ]
            }
          ]
        }
      ],
      "movies": [
        {
          "title": str,
          "tvdb_id": int | null,
          "imdb_id": str | null,
          "is_watched": bool,
          "watched_at": str | null
        }
      ]
    }

    Response: 202 Accepted
    { "job_id": str, "total": int, "status": "PENDING" }

    Idempotent against duplicate submissions: if the user already has a
    PENDING/RUNNING job, that job's handle is returned instead of starting
    a second one. A full export is ~1,100 sequential TMDB calls on a
    single-concurrency Celery worker (render-start.sh runs worker
    --concurrency=1); without this guard, a client that resubmits after a
    dropped poll request (see lib/migration.ts's pollImportJob) would queue
    a second full reprocessing run behind the first, doubling the wait and
    hammering TMDB for nothing since the DB writes are idempotent anyway.

    Resumable against a byte-identical resubmission of a FAILED job (see
    run_tvtime_import's chunking docstring): rather than reprocessing from
    item 0, the existing job is put back to RUNNING and continues from its
    saved `processed` cursor. A different payload, or a job with no
    resumable state, still starts a fresh job as above.
    """

    permission_classes = [IsAuthenticated]

    # Generous vs. the ~5-10 min a full export actually takes (see
    # run_tvtime_import's docstring), tight enough to recover promptly from
    # a genuinely orphaned job — e.g. the whole container restarting mid-run,
    # which render-start.sh's `wait -n` does for the worker on any crash.
    STALE_JOB_AFTER = timedelta(minutes=15)

    def post(self, request):
        shows_data = request.data.get("shows", [])
        movies_data = request.data.get("movies", [])

        if not isinstance(shows_data, list) or not isinstance(movies_data, list):
            return Response(
                {"detail": "Both 'shows' and 'movies' must be arrays."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not shows_data and not movies_data:
            return Response(
                {"detail": "Nothing to import — the file contained no shows or movies."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        in_flight = (
            ImportJob.objects.filter(
                user=request.user,
                status__in=[ImportJob.Status.PENDING, ImportJob.Status.RUNNING],
            )
            .order_by("-created_at")
            .first()
        )
        if in_flight is not None:
            if timezone.now() - in_flight.updated_at <= self.STALE_JOB_AFTER:
                return Response(
                    {"job_id": str(in_flight.id), "total": in_flight.total, "status": in_flight.status},
                    status=status.HTTP_202_ACCEPTED,
                )
            # Orphaned: the worker/container almost certainly died mid-run.
            # Close it out so it stops masking new attempts forever. Payload
            # and the processed cursor are left intact — the resume check
            # below is exactly what a same-file resubmission needs them for.
            in_flight.status = ImportJob.Status.FAILED
            in_flight.detail = "Import stalled and was abandoned (worker restarted mid-run). Please try again."
            in_flight.finished_at = timezone.now()
            in_flight.save(update_fields=["status", "detail", "finished_at", "updated_at"])

        submitted_payload = {"shows": shows_data, "movies": movies_data}
        submitted_fingerprint = _payload_fingerprint(submitted_payload)

        # Resume rather than restart: a FAILED job (a chunk's soft time
        # limit hit — see run_tvtime_import's chunking docstring — or the
        # orphan close-out just above) that still holds its original
        # payload and a partial `processed` cursor can pick up exactly
        # where it left off, skipping every already-completed item
        # outright. Only resume when the resubmitted export is provably
        # the same one though — resuming a different payload under the
        # old cursor would silently skip real, unprocessed items.
        #
        # Matched by fingerprint (a stored sha256), not by re-fetching and
        # deep-comparing the old job's full payload — see
        # _payload_fingerprint's docstring. A FAILED job from before this
        # field existed has an empty fingerprint and simply won't match,
        # falling through to a fresh job below — correct, if not optimally
        # resumed, and self-healing after one such job ages out.
        resumable = (
            ImportJob.objects.filter(
                user=request.user,
                status=ImportJob.Status.FAILED,
                payload_fingerprint=submitted_fingerprint,
            )
            .exclude(payload={})
            .order_by("-created_at")
            .first()
        )
        if resumable is not None and resumable.processed > 0:
            resumable.status = ImportJob.Status.RUNNING
            resumable.detail = ""
            resumable.finished_at = None
            resumable.save(update_fields=["status", "detail", "finished_at", "updated_at"])
            run_tvtime_import.delay(str(resumable.id))
            return Response(
                {"job_id": str(resumable.id), "total": resumable.total, "status": resumable.status},
                status=status.HTTP_202_ACCEPTED,
            )

        job = ImportJob.objects.create(
            user=request.user,
            payload=submitted_payload,
            payload_fingerprint=submitted_fingerprint,
            total=len(shows_data) + len(movies_data),
        )
        run_tvtime_import.delay(str(job.id))

        return Response(
            {"job_id": str(job.id), "total": job.total, "status": job.status},
            status=status.HTTP_202_ACCEPTED,
        )


class ImportJobStatusView(APIView):
    """
    GET /api/import/status/<job_id>/

    Progress + result for one import run, polled by the client's
    ProgressRing. Scoped to the requesting user, so one user cannot read
    another's import.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, job_id):
        job = get_object_or_404(ImportJob, pk=job_id, user=request.user)
        return Response(ImportJobSerializer(job).data, status=status.HTTP_200_OK)
