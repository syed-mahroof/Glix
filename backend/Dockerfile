FROM python:3.12-slim

# Prevent Python from writing .pyc files and buffering stdout
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt /app/
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy the rest of the application codebase
COPY . /app/

# Cold-start fix: this used to run in render-start.sh, at container START —
# meaning every Render free-tier wake-from-sleep (a fresh container start,
# not just a fresh deploy) paid this cost inside the user-visible wake
# window, serially before gunicorn could even bind $PORT. collectstatic is
# a pure filesystem operation (copies/hashes static assets) with no DB/
# Redis/secret-key dependency, so it belongs at image-build time instead —
# baked into the image once per deploy, never again per wake. Forced to
# config.settings.dev regardless of the image's eventual runtime
# DJANGO_SETTINGS_MODULE: STATIC_ROOT is identical in both (inherited
# unchanged from settings/base.py), and prod.py raises ImproperlyConfigured
# without a real DJANGO_SECRET_KEY/DJANGO_ALLOWED_HOSTS, which a build
# stage may not have — dev.py has safe fallbacks for both. Verified this
# exact command runs clean (196 files copied) with no DB connection
# attempted.
RUN DJANGO_SETTINGS_MODULE=config.settings.dev python manage.py collectstatic --noinput

# Make the startup script executable
RUN chmod +x /app/render-start.sh

# Start the application
CMD ["/app/render-start.sh"]
