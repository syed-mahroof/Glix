"""
backend/config/celery.py

Celery application entrypoint. Imported via config/__init__.py so
`@shared_task`-decorated functions in core/tasks.py bind to this app
instance, and so `celery -A config worker` / `celery -A config beat`
resolve correctly.
"""

import os
import ssl

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")

app = Celery("watchtracker")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.broker_use_ssl = {
    "ssl_cert_reqs": ssl.CERT_NONE,
}

app.conf.redis_backend_use_ssl = {
    "ssl_cert_reqs": ssl.CERT_NONE,
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    print(f"Request: {self.request!r}")
