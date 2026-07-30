#!/bin/bash
# backend/render-start.sh
#
# Render's free tier only gives a Web Service a public $PORT and free
# compute — Background Workers (a separate Celery process/dyno) are a
# paid-only service type. This script runs gunicorn + celery worker +
# celery beat as three foreground jobs inside the ONE free Web Service
# container so nothing needs a paid plan. All three inherit this shell's
# stdout/stderr, so all their logs show up interleaved in Render's log
# tab. `wait -n` means if any one process dies, the script exits and
# Render restarts the whole container — all three come back together
# rather than silently running with one process dead.
python manage.py migrate --noinput
python manage.py collectstatic --noinput

celery -A config beat -l INFO &
celery -A config worker --concurrency=1 -l INFO &
# --workers 1 (not more): a 2nd worker process would duplicate this whole
# Django app's memory footprint on a free-tier box that already shares its
# RAM with the celery worker+beat processes above, in this same container.
# --threads 4 --worker-class gthread instead: real concurrency for I/O-bound
# views (DB queries, occasional TMDBService HTTP call) inside that single
# process's memory budget, so one slow/blocked request (e.g. a user's big
# TV Time import chunk hogging CPU) no longer serializes every other user's
# request behind it — which was the main remaining cause of "Can't reach
# Glix" once lib/warmup.ts's cold-start handling was already in place.
# --max-requests/--max-requests-jitter: periodically recycles the worker as
# a cheap safety net against slow memory creep over a long free-tier uptime;
# gunicorn's arbiter starts the replacement before killing the old one, so
# this can't trip the `wait -n` below.
gunicorn config.wsgi:application --bind "0.0.0.0:$PORT" --workers 1 --threads 4 --worker-class gthread --timeout 60 --max-requests 500 --max-requests-jitter 50 &

wait -n
exit $?
