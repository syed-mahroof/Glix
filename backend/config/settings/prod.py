"""
backend/config/settings/prod.py

Production-specific settings.
"""
from .base import *
from .base import SIMPLE_JWT
import os
from django.core.exceptions import ImproperlyConfigured

DEBUG = False

_secret_key_env = os.environ.get("DJANGO_SECRET_KEY")
if not _secret_key_env:
    raise ImproperlyConfigured(
        "DJANGO_SECRET_KEY environment variable must be set when running in production."
    )
SECRET_KEY = _secret_key_env
SIMPLE_JWT["SIGNING_KEY"] = SECRET_KEY

ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",")
    if host.strip()
]
if not ALLOWED_HOSTS:
    raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set in production.")

CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

# Render (like Heroku/Railway) terminates TLS at its edge and forwards
# plain HTTP internally, setting X-Forwarded-Proto to tell us the original
# scheme. Without this, request.is_secure() is always False behind that
# proxy, and SECURE_SSL_REDIRECT below redirect-loops every request forever.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Security headers for production
SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SECURE_SSL_REDIRECT", "True") == "True"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
