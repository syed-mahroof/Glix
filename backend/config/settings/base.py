"""
backend/config/settings/base.py

Base Django settings for Glix project.
Shared across all environments.
"""

import os
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab

# Build paths inside the project like this: BASE_DIR / 'subdir'.
# Since this file is in config/settings/, BASE_DIR should point to backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent

INSTALLED_APPS = [
    "unfold",
    "unfold.contrib.filters",
    "unfold.contrib.forms",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "core.apps.CoreConfig",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Every response this API returns is JSON, which compresses ~8-15x.
    # The Shows Hub's `GET /watchlist/?page_size=all` is the extreme case:
    # a 400+ show library serialises multiple megabytes of episode rows,
    # which on Render's free tier meant gunicorn's --timeout 60 fired
    # before the body finished writing (the user-visible "Can't reach
    # Glix right now" / 502) and burned outbound bandwidth on every
    # single app open. BREACH is not a concern here: auth is a JWT in the
    # Authorization header, not a cookie, and no CSRF token or other
    # secret is ever reflected into a response body next to attacker-
    # controlled input.
    "django.middleware.gzip.GZipMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

# Database defaults (can be overridden in dev/prod)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "watchtracker"),
        "USER": os.environ.get("POSTGRES_USER", "watchtracker"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "watchtracker"),
        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        # "prefer" negotiates TLS when the server offers it (managed hosts
        # like Neon/Render Postgres do) and falls back to plain when it
        # doesn't (local Docker Postgres) — same setting works unchanged
        # in both places, no per-environment override needed.
        "OPTIONS": {"sslmode": os.environ.get("POSTGRES_SSLMODE", "prefer")},
        # Phase 74/Group J: was unset anywhere in the project, which
        # defaults to 0 — a fresh TCP+TLS handshake to the managed Postgres
        # host on every single request, real latency on a host with no
        # local connection pooler in front of it. 60s keeps a connection
        # alive across a burst of requests from the same worker thread
        # without holding it open indefinitely against a host that may
        # itself close idle connections.
        "CONN_MAX_AGE": int(os.environ.get("DB_CONN_MAX_AGE", "60")),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# whitenoise serves collected static (admin CSS/JS) directly from the app
# process — no separate nginx/CDN needed on a single-dyno host like Render.
# Requires `manage.py collectstatic` to run at build/release time.
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardResultsPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "core.exceptions.custom_exception_handler",
    "DEFAULT_RENDERER_CLASSES": (
        "rest_framework.renderers.JSONRenderer",
    ),
    # No throttling existed anywhere in the project before this — every
    # endpoint, including auth/login, was unlimited. Rates are generous
    # enough not to bite legitimate use: the import-status poll
    # (lib/migration.ts's pollImportJob) hits ~40/min at its 1.5s
    # interval, comfortably under "user". "anon" only gates login/
    # register/refresh, where a real user makes a handful of calls, not
    # dozens per minute.
    "DEFAULT_THROTTLE_CLASSES": (
        "core.throttling.LocalAnonRateThrottle",
        "core.throttling.LocalUserRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        "anon": "20/min",
        "user": "120/min",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": os.environ.get("DJANGO_SECRET_KEY", "insecure-key-for-jwt"),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

# TMDB proxy (see core/services.py)
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")

# Sign in with Google/Apple (core/social_auth.py). These are the accepted
# ID-token audiences, not secrets — comma-separated so ops can add e.g. a
# future web client ID without a code change. Empty by default so
# verification fails closed until real values are provisioned; this is
# deliberately safer than accepting any audience.
GOOGLE_OAUTH_CLIENT_IDS = [
    cid.strip() for cid in os.environ.get("GOOGLE_OAUTH_CLIENT_IDS", "").split(",") if cid.strip()
]
APPLE_AUDIENCES = [
    aud.strip() for aud in os.environ.get("APPLE_AUDIENCES", "").split(",") if aud.strip()
]

# Forgot-password OTP emails (core/password_reset.py). Gmail SMTP + App
# Password — no domain owned, so a transactional provider (Resend/SES)
# requiring domain verification isn't an option yet. Swap EMAIL_HOST/
# credentials later if that changes; send_mail call sites don't change.
EMAIL_BACKEND = os.environ.get("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = os.environ.get("EMAIL_HOST", "smtp.gmail.com")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "587"))
EMAIL_USE_TLS = os.environ.get("EMAIL_USE_TLS", "True") == "True"
EMAIL_HOST_USER = os.environ.get("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.environ.get("EMAIL_HOST_PASSWORD", "")

# Gmail rejects/rewrites a From header that isn't the authenticated
# account, so this defaults to EMAIL_HOST_USER rather than a vanity
# address Glix doesn't own a domain for.
DEFAULT_FROM_EMAIL = os.environ.get("DEFAULT_FROM_EMAIL", f"Glix <{EMAIL_HOST_USER}>")

# Django's cache framework defaulted to per-process LocMemCache the whole
# time — nothing in this file ever set CACHES. That silently undermined
# two things at once: TMDBService's `use_cache=True` responses (the whole
# point of caching TMDB is to stay under rate limits across the *fleet*,
# not one worker) and DRF throttling below (a per-process counter isn't a
# real rate limit once there's more than one worker/pod). Django 6 ships
# a native Redis backend — no new dependency; `redis` is already required
# for Celery. Deliberately a different db index (2) than Celery's
# broker/result backend (0) so a `FLUSHDB` on one can't wipe the other.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": os.environ.get("REDIS_CACHE_URL", "redis://localhost:6379/2"),
        # Phase 74/Group J: OPTIONS was empty, so a slow/unreachable Redis
        # (Upstash on the free tier, e.g.) had no socket-level timeout at
        # all and could hang a request indefinitely instead of failing
        # fast. Django's *native* RedisCache (this file — not the
        # third-party django-redis package) passes OPTIONS straight
        # through to redis-py's ConnectionPool.from_url(), so only real
        # redis-py connection kwargs belong here. There is deliberately no
        # IGNORE_EXCEPTIONS: that's a django-redis-only feature this
        # backend doesn't implement — setting it would raise a TypeError
        # from redis-py's own Connection.__init__ rather than silently
        # degrading. Graceful degrade-on-cache-failure would need either
        # switching backends or wrapping every cache.get/set call site;
        # out of scope for this pass. Failing fast (a few seconds, not a
        # request-killing hang) is still strictly better than unbounded.
        "OPTIONS": {
            "socket_connect_timeout": 3,
            "socket_timeout": 3,
        },
    },
    # DRF throttling (below) checked a Redis GET+SET per throttle class on
    # every single authenticated request — with AnonRateThrottle and
    # UserRateThrottle both active, that's 2 extra Redis round trips per
    # request across the whole API, purely for a per-process rate-limit
    # counter that doesn't need to survive a restart or be shared with any
    # other reader. Safe to move to a local in-memory cache specifically
    # because render-start.sh runs gunicorn with --workers 1 (Phase 75.8) —
    # a second worker process would each keep its own counter and the limit
    # would silently double, which is exactly the problem the comment above
    # this dict already flagged Redis as fixing for a multi-worker fleet.
    # --max-requests 500 recycles the process periodically, which resets
    # this cache along with it — an accepted tradeoff for abuse protection,
    # not a correctness requirement.
    "throttling": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "throttling",
    },
}

# Django's default (2.5MB) is well under what a real TV Time export's JSON
# body can be — a few hundred shows with full season/episode watch history
# routinely runs several MB. Over the default, DRF's parser raises
# RequestDataTooBig before TVTimeImportView.post() ever runs, which the
# client's axios layer can present indistinguishably from any other
# request failure. 25MB comfortably covers even a very large multi-
# thousand-episode library (payload is plain JSON, no embedded media).
DATA_UPLOAD_MAX_MEMORY_SIZE = 25 * 1024 * 1024

# django-unfold admin theme. PRIMARY ramp is generated from the app's own
# accent (#E4FA1A, see client-mobile/lib/theme.ts) converted to OKLCH and
# expanded across an in-gamut lightness ramp at the same hue (116.11deg) —
# not the package default purple — so the admin reads as Glix, not
# a generic Unfold install. See docs/design/unfold-theme-notes (AUDIT.md
# Phase 26 entry) for the conversion script.
UNFOLD = {
    "SITE_TITLE": "Glix Admin",
    "SITE_HEADER": "Glix",
    "SITE_SUBHEADER": "Admin",
    "SITE_URL": "/",
    "SHOW_HISTORY": True,
    "SHOW_VIEW_ON_SITE": True,
    "SHOW_BACK_BUTTON": True,
    "COLORS": {
        "primary": {
            "50": "oklch(98.5% 0.041 116.11)",
            "100": "oklch(96.7% 0.102 116.11)",
            "200": "oklch(92.8% 0.174 116.11)",
            "300": "oklch(87.2% 0.164 116.11)",
            "400": "oklch(70.7% 0.133 116.11)",
            "500": "oklch(55.1% 0.104 116.11)",
            "600": "oklch(44.6% 0.084 116.11)",
            "700": "oklch(37.3% 0.071 116.11)",
            "800": "oklch(27.8% 0.054 116.11)",
            "900": "oklch(21.0% 0.042 116.11)",
            "950": "oklch(13.0% 0.033 116.11)",
        },
    },
    "SIDEBAR": {
        "show_search": True,
        "show_all_applications": True,
        "navigation": [
            {
                "title": "Users & Profiles",
                "separator": True,
                "items": [
                    {
                        "title": "Users",
                        "icon": "person",
                        "link": "/admin/auth/user/",
                    },
                    {
                        "title": "Profiles",
                        "icon": "badge",
                        "link": "/admin/core/userprofile/",
                    },
                    {
                        "title": "Linked accounts",
                        "icon": "link",
                        "link": "/admin/core/socialaccount/",
                    },
                ],
            },
            {
                "title": "Watch Data",
                "separator": True,
                "items": [
                    {
                        "title": "Watchlist",
                        "icon": "bookmark",
                        "link": "/admin/core/watchlist/",
                    },
                    {
                        "title": "Watch state",
                        "icon": "visibility",
                        "link": "/admin/core/watchstate/",
                    },
                    {
                        "title": "Movie watchlist",
                        "icon": "movie",
                        "link": "/admin/core/moviewatchlist/",
                    },
                    {
                        "title": "Movie watch state",
                        "icon": "check_circle",
                        "link": "/admin/core/moviewatchstate/",
                    },
                    {
                        "title": "Watch streaks",
                        "icon": "local_fire_department",
                        "link": "/admin/core/watchstreak/",
                    },
                    {
                        "title": "Import jobs",
                        "icon": "cloud_upload",
                        "link": "/admin/core/importjob/",
                    },
                ],
            },
            {
                "title": "TMDB Cache",
                "separator": True,
                "items": [
                    {
                        "title": "Cached shows",
                        "icon": "tv",
                        "link": "/admin/core/cachedshow/",
                    },
                    {
                        "title": "Cached episodes",
                        "icon": "movie_filter",
                        "link": "/admin/core/cachedepisode/",
                    },
                    {
                        "title": "Movie cache",
                        "icon": "theaters",
                        "link": "/admin/core/moviecache/",
                    },
                ],
            },
            {
                "title": "Community",
                "separator": True,
                "items": [
                    {
                        "title": "Comments",
                        "icon": "comment",
                        "link": "/admin/core/comment/",
                    },
                    {
                        "title": "Comment reports",
                        "icon": "flag",
                        "link": "/admin/core/commentreport/",
                    },
                    {
                        "title": "Episode interactions",
                        "icon": "emoji_emotions",
                        "link": "/admin/core/episodeinteraction/",
                    },
                ],
            },
        ],
    },
}

# Celery
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = TIME_ZONE

# Free-tier survival settings. render-start.sh runs gunicorn + this worker
# + beat inside ONE container, so the worker's memory is the web server's
# memory. Defaults are tuned for a dedicated worker box and were actively
# hostile here:
#  - prefetch_multiplier defaults to 4: the worker reserves up to 4 queued
#    tasks it isn't running yet. With --concurrency=1 that just delays
#    every other user's badge/streak/push task behind one long import
#    chain, and pins their payloads in RAM for no reason.
#  - acks_late=False (the default) acknowledges a task the moment it's
#    handed to the worker. When the container is restarted mid-import
#    (Render "Instance failed", or render-start.sh's `wait -n` reacting to
#    any of the three processes dying), the in-flight chunk was already
#    acked and simply vanished — which is exactly how an import job ends
#    up stuck at RUNNING 69/466 forever with nothing left to resume it.
#    With acks_late the broker redelivers it. Our tasks are idempotent by
#    construction (see run_tvtime_import's cursor + diff), so redelivery
#    is safe.
#  - max_tasks_per_child recycles the worker process periodically, which
#    is the cheap fix for the slow RSS creep a few thousand TMDB responses
#    and multi-megabyte import payloads leave behind.
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_MAX_TASKS_PER_CHILD = 40
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
# Redelivery window for an acks_late task whose worker died. Must exceed
# run_tvtime_import's hard time_limit so a chunk that is genuinely still
# running is never handed to a second worker in parallel.
#
# polling_interval (Phase 75.8): Celery's Redis transport BRPOPs the queue
# in a tight loop with no polling_interval set at all, which defaults to
# effectively continuous polling — on Upstash's command-metered free tier
# this alone was the majority of the ~130K/500K monthly commands, dwarfing
# every real app request combined. 5 seconds is still well within "a task
# gets picked up almost immediately" for a background job queue (badges,
# streaks, push notifications, air-time syncs) — nothing here is latency-
# sensitive the way a user-facing request is.
CELERY_BROKER_TRANSPORT_OPTIONS = {"visibility_timeout": 900, "polling_interval": 5.0}

# Nothing in this codebase ever calls AsyncResult(...)/.get() on a task (every
# call site is .delay()/.apply_async() and moves on) — confirmed via a repo
# grep before setting this. Every task result Celery would otherwise store in
# the Redis result backend (CELERY_RESULT_BACKEND) is dead weight: a write
# nobody ever reads, on the same free-tier command budget as everything else.
CELERY_TASK_IGNORE_RESULT = True

# Cluster coordination for a fleet of workers — gossip (worker-to-worker
# presence chatter), mingle (sync state with other workers at startup), and
# remote control/monitoring (broadcast commands, task-event messages) all
# assume more than one worker exists to coordinate with. render-start.sh
# runs exactly one (--concurrency=1, no other worker process anywhere), so
# every one of these is pure Redis PUBLISH/subscribe overhead with nothing
# on the other end. (gossip/mingle/heartbeat are also disabled per-process
# via render-start.sh's celery worker flags — belt and suspenders, since
# these settings and those CLI flags cover slightly different code paths.)
CELERY_WORKER_ENABLE_REMOTE_CONTROL = False
CELERY_WORKER_SEND_TASK_EVENTS = False

# Periodic tasks (requires the celery-beat service in docker-compose.yml
# to actually be running — a worker alone never fires these on its own).
# sync_active_shows re-syncs RETURNING shows so refresh_show_cache can
# detect newly-aired episodes and push "new episode" alerts; without
# this schedule, push notifications never fire no matter how the user
# has their Settings toggles set.
CELERY_BEAT_SCHEDULE = {
    "sync-active-shows-every-6-hours": {
        "task": "core.tasks.sync_active_shows",
        "schedule": crontab(minute=0, hour="*/6"),
    },
    "send-weekly-digest-monday-9am": {
        "task": "core.tasks.send_weekly_digest",
        "schedule": crontab(minute=0, hour=9, day_of_week=1),
    },
    # An import is a self-re-enqueueing chain of short chunks; if the
    # container dies between two links the chain is gone and the job sits
    # at RUNNING forever (observed: a real job stuck at 69/466 for a day).
    # acks_late above covers a chunk that was mid-flight; this covers the
    # gap where nothing was in flight at all. Every 15 minutes (widened from
    # 5 — Phase 75.8: a stalled import is a rare failure path, and self-
    # healing within 15 minutes instead of 5 is still fine for it, at
    # roughly a third of the beat-tick volume) so a stalled import self-heals
    # rather than needing the user to resubmit.
    "resume-stalled-imports-every-15-minutes": {
        "task": "core.tasks.resume_stalled_imports",
        "schedule": crontab(minute="*/15"),
    },
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {"class": "logging.StreamHandler"},
    },
    "root": {
        "handlers": ["console"],
        "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO"),
    },
}
