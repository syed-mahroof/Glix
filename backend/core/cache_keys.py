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
