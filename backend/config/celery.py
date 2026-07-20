"""
backend/config/celery.py

Celery application entrypoint. Imported via config/__init__.py so
`@shared_task`-decorated functions in core/tasks.py bind to this app
instance, and so `celery -A config worker` / `celery -A config beat`
resolve correctly.
"""

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("watchtracker")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")