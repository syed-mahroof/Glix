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
set -e

python manage.py migrate --noinput
python manage.py collectstatic --noinput

celery -A config beat -l INFO &
celery -A config worker -l INFO &
gunicorn config.wsgi:application --bind "0.0.0.0:$PORT" --workers 2 --timeout 60 &

wait -n
exit $?
