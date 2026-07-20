# backend/core/migrations/0003_movie_models.py
# Hand-written migration for MovieCache, MovieWatchState, MovieWatchlist.
# Run with: python manage.py migrate

import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_notificationpreference"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # ── MovieCache ────────────────────────────────────────────────────
        migrations.CreateModel(
            name="MovieCache",
            fields=[
                (
                    "tmdb_id",
                    models.PositiveIntegerField(primary_key=True, serialize=False),
                ),
                ("title", models.CharField(db_index=True, max_length=255)),
                ("overview", models.TextField(blank=True)),
                (
                    "poster_path",
                    models.CharField(blank=True, max_length=255, null=True),
                ),
                (
                    "backdrop_path",
                    models.CharField(blank=True, max_length=255, null=True),
                ),
                ("release_date", models.DateField(blank=True, null=True)),
                (
                    "runtime_minutes",
                    models.PositiveIntegerField(
                        default=0,
                        help_text="Used to increment/decrement UserProfile.total_time_watched on toggle.",
                    ),
                ),
                (
                    "genres_string",
                    models.CharField(
                        blank=True,
                        help_text="Comma-separated genre names, e.g. 'Drama, Comedy, Thriller'.",
                        max_length=255,
                    ),
                ),
                ("vote_average", models.FloatField(default=0.0)),
                ("last_synced_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "movie_cache"},
        ),
        migrations.AddIndex(
            model_name="moviecache",
            index=models.Index(
                fields=["last_synced_at"], name="idx_movie_last_synced"
            ),
        ),
        # ── MovieWatchState ───────────────────────────────────────────────
        migrations.CreateModel(
            name="MovieWatchState",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "movie",
                    models.ForeignKey(
                        db_column="movie_id",
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="watch_states",
                        to="core.moviecache",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="movie_watch_states",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("watched_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={"db_table": "movie_watch_state"},
        ),
        migrations.AddConstraint(
            model_name="moviewatchstate",
            constraint=models.UniqueConstraint(
                fields=["user", "movie"], name="unique_user_movie_watch"
            ),
        ),
        migrations.AddIndex(
            model_name="moviewatchstate",
            index=models.Index(
                fields=["user", "movie"], name="idx_moviewatch_user_movie"
            ),
        ),
        migrations.AddIndex(
            model_name="moviewatchstate",
            index=models.Index(
                fields=["user", "watched_at"], name="idx_moviewatch_user_watched_at"
            ),
        ),
        # ── MovieWatchlist ────────────────────────────────────────────────
        migrations.CreateModel(
            name="MovieWatchlist",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "movie",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="watchlist_entries",
                        to="core.moviecache",
                    ),
                ),
                (
                    "user",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="movie_watchlist_entries",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                ("added_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"db_table": "movie_watchlist"},
        ),
        migrations.AddConstraint(
            model_name="moviewatchlist",
            constraint=models.UniqueConstraint(
                fields=["user", "movie"], name="unique_user_movie_watchlist"
            ),
        ),
        migrations.AddIndex(
            model_name="moviewatchlist",
            index=models.Index(fields=["user"], name="idx_movie_watchlist_user"),
        ),
    ]
