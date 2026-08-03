"""
backend/core/throttling.py

DRF's built-in AnonRateThrottle/UserRateThrottle always read/write through
`django.core.cache.cache` (the "default" alias) — on this project that's
Redis, so every throttled request paid a GET+SET against Upstash just to
maintain a rate-limit counter (Phase 75.8). These subclasses point at the
"throttling" cache alias (settings.CACHES) instead, a local LocMemCache —
safe specifically because render-start.sh runs gunicorn with --workers 1,
so there is exactly one counter to keep, not one per worker process that
would silently multiply the effective rate limit.
"""

from django.core.cache import caches
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class LocalAnonRateThrottle(AnonRateThrottle):
    cache = caches["throttling"]


class LocalUserRateThrottle(UserRateThrottle):
    cache = caches["throttling"]
