"""
backend/config/__init__.py

Ensures the Celery app is loaded whenever Django starts, so
`@shared_task` in core/tasks.py always has an app to bind to.
"""

from config.celery import app as celery_app

__all__ = ("celery_app",)