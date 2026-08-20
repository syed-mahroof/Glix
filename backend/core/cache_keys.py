"""
backend/core/cache_keys.py

Centralized cache key builders for the per-user response cache on the two
heaviest list endpoints (WatchlistView's page_size=all path, MovieWatchlistView).
One place so the view (read+write) and every invalidation call site
(signals.py, tasks.py) build the identical key instead of hand-formatting
the same f-string in three-plus files.
"""


def watchlist_cache_key(user_id) -> str:
    return f"watchlist_all:{user_id}"


def movie_watchlist_cache_key(user_id) -> str:
    return f"movie_watchlist:{user_id}"


def recommendations_cache_key(user_id, media_type: str) -> str:
    """`media_type` is "tv" or "movie" — the Discover Hub's segment.

    It is part of the key, not an afterthought: the two segments now return
    genuinely different feeds (different seeds, different candidates), so a
    single shared key would serve whichever one happened to warm the cache
    first to both tabs for the next six hours.
    """
    return f"recommendations_for_you:{media_type}:{user_id}"


# Short on purpose: this is a defense-in-depth backstop, not the primary
# invalidation mechanism (that's the post_save/post_delete signals in
# signals.py). A missed edge case self-heals within this window instead of
# staying wrong indefinitely.
CACHE_TTL_SECONDS = 25

# Recommendations have no correctness requirement the way watchlist counts
# do — a taste profile built from the last few hours of TMDB calls is still
# a perfectly good "for you" feed. Long TTL on purpose to avoid re-running
# several live TMDB recommendation calls per user on every screen visit; no
# signal invalidation either, since nothing here is wrong-and-stays-wrong,
# only slightly-behind-and-self-heals.
RECOMMENDATIONS_CACHE_TTL_SECONDS = 6 * 60 * 60


def public_profile_cache_key(user_id) -> str:
    return f"public_profile:{user_id}"


# UserProfileDetailView is ~11 queries on a Render free-tier box with no
# CONN_MAX_AGE — caching the target-owned blob is not optional there.
# TTL-only, no signal invalidation: someone else's episode count being a
# few minutes stale is invisible, and every extra receiver in signals.py
# is a new bug surface.
PUBLIC_PROFILE_CACHE_TTL_SECONDS = 300


def friends_feed_cache_key(user_id, page=1) -> str:
    """
    `page` is part of the key — it used to not be, which meant every page
    of FriendsActivityView's paginated response shared one cache slot:
    whichever page warmed the cache first (always page 1, since that's the
    first request any client makes) was then served back for every
    subsequent page too, so infinite scroll just repeated page 1 forever
    for the rest of the TTL. Each page now gets its own entry.
    """
    return f"friends_feed:{user_id}:{page}"


# Short — "recent activity from people you follow" being briefly stale is
# by definition still recent. Kept short specifically so a just-completed
# binge shows up in a followee's feed within a couple of minutes.
FRIENDS_FEED_CACHE_TTL_SECONDS = 120


def analytics_heatmap_all_cache_key(user_id) -> str:
    return f"analytics_heatmap_all:{user_id}"


# Longer than the social caches above — a multi-year rollup is expensive
# relative to how often it visibly changes (the user has to mark another
# episode watched AND go looking at "Full history" again). The plain
# 365-day heatmap stays uncached on purpose; this sparse/all-time mode is
# the one worth the staleness tradeoff.
ANALYTICS_HEATMAP_ALL_CACHE_TTL_SECONDS = 900


def analytics_movies_cache_key(user_id) -> str:
    return f"analytics_movies:{user_id}"


# Invalidated by signals.py's existing MovieWatchlist/MovieWatchState
# receiver pair (the same one movie_watchlist_cache_key uses), so this TTL
# is a defense-in-depth backstop, not the primary invalidation mechanism —
# short is still fine to keep, matching CACHE_TTL_SECONDS's own reasoning.
ANALYTICS_MOVIES_CACHE_TTL_SECONDS = 300


def analytics_dashboard_cache_key(user_id) -> str:
    return f"analytics_dashboard:{user_id}"


# Phase 75.8 — AnalyticsDashboardView was previously uncached despite doing
# several grouped aggregate queries on every Profile Hub / Analytics tab
# focus. Invalidated by signals.py's WatchState/MovieWatchState/rewatch
# receivers; this TTL is the same defense-in-depth backstop as
# ANALYTICS_MOVIES_CACHE_TTL_SECONDS above.
ANALYTICS_DASHBOARD_CACHE_TTL_SECONDS = 300


def analytics_statistics_cache_key(user_id) -> str:
    return f"analytics_statistics:{user_id}"


# Same reasoning as ANALYTICS_DASHBOARD_CACHE_TTL_SECONDS — this endpoint's
# daily/weekly/monthly/yearly buckets are the most query-heavy analytics
# view in the app.
ANALYTICS_STATISTICS_CACHE_TTL_SECONDS = 300


def analytics_genres_cache_key(user_id) -> str:
    return f"analytics_genres:{user_id}"


# Phase 85, Batch D — AnalyticsGenresView was the single slowest analytics
# endpoint measured against production (~2.1s, every single call, on a
# real 400+ show library — see PROJECT_STATUS.md's Batch D entry for the
# actual numbers): it was entirely uncached, unlike its dashboard/statistics
# siblings. Same TTL/invalidation reasoning as those two — invalidated by
# signals.py's WatchState receiver (_bust_analytics_dashboard_and_statistics_cache,
# which this key was added to rather than inventing a fourth near-identical
# bust helper).
ANALYTICS_GENRES_CACHE_TTL_SECONDS = 300


def analytics_monthly_summary_cache_key(user_id, year) -> str:
    return f"analytics_monthly_summary:{user_id}:{year}"


# Longer than the two above — a past year's summary essentially never
# changes once that year is over, and even the current year's cached copy
# only needs to catch up eventually, not immediately, the way a live
# dashboard total does. Only the current year's key is signal-busted (see
# signals.py) — a backfilled watch dated into a past year (e.g. a TV Time
# import) leaves that past year's cache to this TTL instead, which is fine:
# nobody is staring at last year's recap waiting for a single import to land.
ANALYTICS_MONTHLY_SUMMARY_CACHE_TTL_SECONDS = 900
