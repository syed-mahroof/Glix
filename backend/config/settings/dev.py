"""
backend/config/settings/dev.py

Development-specific settings.
"""
from .base import *
from .base import SIMPLE_JWT
import os

DEBUG = True

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "django-insecure-local-dev-key-change-me-before-deploying")
SIMPLE_JWT["SIGNING_KEY"] = SECRET_KEY

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,*").split(",")
    if host.strip()
]

# Allow all origins for local Expo dev client convenience
CORS_ALLOW_ALL_ORIGINS = True

# Overwrite databases if you prefer SQLite for dev, else leave it as inherited postgres
# Here we inherit the PostgreSQL config from base.py
