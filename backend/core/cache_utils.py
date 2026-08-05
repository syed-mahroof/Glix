"""
backend/core/cache_utils.py

Phase 83 perf: CACHES["default"] (config/settings/base.py) deliberately has
no IGNORE_EXCEPTIONS — that's a django-redis-only feature Django's native
RedisCache backend doesn't implement, and setting it would TypeError out of
redis-py's own connection setup rather than silently degrading. That
settings.py comment left "wrapping every cache.get/set call site" as future
work; this module is that work, applied only where a cache MISS is always
the safe fallback for a Redis error too.

Deliberately NOT used by core/password_reset.py's OTP/reset-token cache
calls: those aren't a performance cache, they're the actual store of truth
for a resend cooldown and a pending reset's state. Treating a Redis error
there as "cache miss" would either silently bypass the resend-cooldown
security control or incorrectly reject a legitimate in-progress reset —
both worse than the request failing loudly, which is what already happens
and is correct for that file.

Everywhere else here, a cache.get() that raises is truly indistinguishable
from a cache MISS from the caller's point of view: the caller already has a
"compute it fresh" fallback for the miss case (that's what caching means),
so routing a Redis error into that same fallback is strictly safe — it
costs a slower response (a DB query, a TMDB call), never a wrong one. A
cache.set()/delete() that raises just means the write didn't happen; the
same "safe to lose" reasoning signals.py already applies to on_commit cache
invalidation (a stale cache entry self-heals on its own TTL) extends
naturally to a Redis outage on the write path too.
"""

import logging

from django.core.cache import cache
from redis.exceptions import RedisError

logger = logging.getLogger(__name__)


def safe_cache_get(key: str, default=None):
    """cache.get() that treats a Redis error the same as a cache miss."""
    try:
        return cache.get(key, default)
    except RedisError:
        logger.warning("Redis unavailable on cache.get(%s) — treating as a miss", key)
        return default


def safe_cache_set(key: str, value, timeout=None) -> None:
    """cache.set() that swallows a Redis error — the write is lost, not the request."""
    try:
        cache.set(key, value, timeout)
    except RedisError:
        logger.warning("Redis unavailable on cache.set(%s) — write dropped", key)


def safe_cache_delete(key: str) -> None:
    """cache.delete() that swallows a Redis error — same reasoning as safe_cache_set."""
    try:
        cache.delete(key)
    except RedisError:
        logger.warning("Redis unavailable on cache.delete(%s) — invalidation dropped", key)
