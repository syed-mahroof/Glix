"""
backend/core/admin.py
"""

from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group, User

from unfold.admin import ModelAdmin
from unfold.forms import (
    AdminPasswordChangeForm,
    UserChangeForm,
    UserCreationForm,
)

from core.models import (
    CachedEpisode,
    CachedShow,
    Comment,
    CommentLike,
    CommentReport,
    EpisodeInteraction,
    ImportJob,
    MovieCache,
    MovieWatchlist,
    MovieWatchState,
    NotificationPreference,
    SocialAccount,
    UserProfile,
    Watchlist,
    WatchState,
    WatchStreak,
)

admin.site.unregister(User)
admin.site.unregister(Group)


@admin.register(User)
class UserAdmin(BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm


@admin.register(Group)
class GroupAdmin(BaseGroupAdmin, ModelAdmin):
    pass


@admin.register(UserProfile)
class UserProfileAdmin(ModelAdmin):
    list_display = ("user", "total_time_watched", "created_at")
    search_fields = ("user__username", "user__email")
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("user",)


@admin.register(SocialAccount)
class SocialAccountAdmin(ModelAdmin):
    list_display = ("user", "provider", "email", "created_at")
    list_filter = ("provider",)
    search_fields = ("user__username", "user__email", "provider_user_id", "email")
    autocomplete_fields = ("user",)
    readonly_fields = ("created_at",)


@admin.register(CachedShow)
class CachedShowAdmin(ModelAdmin):
    list_display = (
        "tmdb_id",
        "title",
        "status",
        "total_seasons",
        "total_episodes",
        "last_synced_at",
    )
    list_filter = ("status",)
    search_fields = ("title",)
    readonly_fields = ("last_synced_at",)


@admin.register(CachedEpisode)
class CachedEpisodeAdmin(ModelAdmin):
    list_display = (
        "tmdb_id",
        "show",
        "season_number",
        "episode_number",
        "air_date",
        "runtime_minutes",
    )
    list_filter = ("season_number",)
    search_fields = ("title", "show__title")
    autocomplete_fields = ("show",)


@admin.register(Watchlist)
class WatchlistAdmin(ModelAdmin):
    list_display = ("user", "show", "status", "is_favorite", "updated_at")
    list_filter = ("status", "is_favorite")
    search_fields = ("user__username", "show__title")
    autocomplete_fields = ("user", "show")


@admin.register(WatchState)
class WatchStateAdmin(ModelAdmin):
    list_display = ("user", "episode", "watched_at")
    search_fields = ("user__username", "episode__title")
    autocomplete_fields = ("user", "episode")


@admin.register(EpisodeInteraction)
class EpisodeInteractionAdmin(ModelAdmin):
    list_display = ("user", "episode", "emotion_emoji", "mvp_character_name", "created_at")
    search_fields = ("user__username", "episode__title", "mvp_character_name")
    autocomplete_fields = ("user", "episode")


@admin.register(WatchStreak)
class WatchStreakAdmin(ModelAdmin):
    list_display = ("user", "current_streak", "longest_streak", "total_streak_days", "last_watch_date", "updated_at")
    search_fields = ("user__username",)
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("user",)


@admin.register(NotificationPreference)
class NotificationPreferenceAdmin(ModelAdmin):
    list_display = ("user", "notify_new_episode", "notify_weekly_digest", "updated_at")
    list_filter = ("notify_new_episode", "notify_weekly_digest")
    search_fields = ("user__username",)
    readonly_fields = ("created_at", "updated_at")
    autocomplete_fields = ("user",)


@admin.register(MovieCache)
class MovieCacheAdmin(ModelAdmin):
    list_display = ("tmdb_id", "title", "release_date", "vote_average", "last_synced_at")
    search_fields = ("title",)
    readonly_fields = ("last_synced_at",)


@admin.register(MovieWatchState)
class MovieWatchStateAdmin(ModelAdmin):
    list_display = ("user", "movie", "watched_at")
    search_fields = ("user__username", "movie__title")
    autocomplete_fields = ("user", "movie")


@admin.register(MovieWatchlist)
class MovieWatchlistAdmin(ModelAdmin):
    list_display = ("user", "movie", "added_at", "updated_at")
    search_fields = ("user__username", "movie__title")
    autocomplete_fields = ("user", "movie")


@admin.register(Comment)
class CommentAdmin(ModelAdmin):
    list_display = ("user", "show", "episode", "parent", "is_spoiler", "is_deleted", "created_at")
    list_filter = ("is_spoiler", "is_deleted", "is_edited")
    search_fields = ("user__username", "body")
    autocomplete_fields = ("user", "show", "episode", "parent")
    readonly_fields = ("created_at", "updated_at")


@admin.register(CommentLike)
class CommentLikeAdmin(ModelAdmin):
    list_display = ("user", "comment", "created_at")
    search_fields = ("user__username",)
    autocomplete_fields = ("user", "comment")


@admin.register(CommentReport)
class CommentReportAdmin(ModelAdmin):
    list_display = ("comment", "reporter", "reason", "status", "reviewed_by", "created_at")
    list_filter = ("reason", "status")
    search_fields = ("reporter__username", "comment__body")
    autocomplete_fields = ("reporter", "comment", "reviewed_by")
    readonly_fields = ("created_at",)


@admin.register(ImportJob)
class ImportJobAdmin(ModelAdmin):
    list_display = (
        "id",
        "user",
        "status",
        "processed",
        "total",
        "shows_imported",
        "movies_imported",
        "episodes_marked",
        "created_at",
    )
    list_filter = ("status",)
    search_fields = ("user__username",)
    autocomplete_fields = ("user",)
    readonly_fields = ("created_at", "finished_at")
