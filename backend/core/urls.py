"""
backend/core/urls.py
"""

from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from core.auth_views import (
    AppleLoginView,
    GoogleLoginView,
    LoginView,
    LogoutView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    PasswordResetVerifyView,
    RegisterView,
)
from core.profile_views import AvatarOptionsView, ProfileView
from core.search_views import (
    EpisodeCreditsView,
    EpisodeDetailView,
    MovieCreditsView,
    MovieDetailView,
    MovieRecommendationsView,
    MovieWatchProvidersView,
    SeasonEpisodesView,
    ShowCreditsView,
    ShowDetailView,
    ShowRecommendationsView,
    ShowSearchView,
    UniversalSearchView,
    WatchProvidersView,
)
from core.views import (
    ArchiveToggleView,
    BulkWatchStateToggleView,
    CatchupCheckView,
    CatchupPreferenceView,
    ContinueWatchingView,
    DiscoverFilterView,
    DiscoverGenresView,
    EpisodeInteractionView,
    FavoriteToggleView,
    ImportJobStatusView,
    MovieAddView,
    MovieWatchlistView,
    MovieWatchStateToggleView,
    ShowAddView,
    TVTimeImportView,
    WatchlistView,
    WatchStateToggleView,
    NotificationPreferenceView,
    DiscoverFeedView,
    WatchHistoryView,
)

urlpatterns = [
    # Auth
    path("auth/register/", RegisterView.as_view(), name="auth-register"),
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/logout/", LogoutView.as_view(), name="auth-logout"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="auth-refresh"),
    path("auth/google/", GoogleLoginView.as_view(), name="auth-google"),
    path("auth/apple/", AppleLoginView.as_view(), name="auth-apple"),
    path("auth/password-reset/request/", PasswordResetRequestView.as_view(), name="auth-password-reset-request"),
    path("auth/password-reset/verify/", PasswordResetVerifyView.as_view(), name="auth-password-reset-verify"),
    path("auth/password-reset/confirm/", PasswordResetConfirmView.as_view(), name="auth-password-reset-confirm"),
    # Watchlist / tracking
    path("watchlist/", WatchlistView.as_view(), name="watchlist"),
    path("watchlist/add/", ShowAddView.as_view(), name="watchlist-add"),
    path("watchlist/favorite/", FavoriteToggleView.as_view(), name="watchlist-favorite"),
    path(
        "watchlist/catchup-preference/",
        CatchupPreferenceView.as_view(),
        name="watchlist-catchup-preference",
    ),
    path("watchlist/archive/", ArchiveToggleView.as_view(), name="watchlist-archive"),
    path("watch-state/toggle/", WatchStateToggleView.as_view(), name="watch-state-toggle"),
    path("watch-state/bulk-toggle/", BulkWatchStateToggleView.as_view(), name="watch-state-bulk-toggle"),
    path("watch-state/catchup-check/", CatchupCheckView.as_view(), name="watch-state-catchup-check"),
    path("watch-history/", WatchHistoryView.as_view(), name="watch-history"),
    path("episode/interaction/", EpisodeInteractionView.as_view(), name="episode-interaction"),
    path("continue-watching/", ContinueWatchingView.as_view(), name="continue-watching"),
    # Profile & Settings
    path("profile/", ProfileView.as_view(), name="profile"),
    path("profile/avatar-options/", AvatarOptionsView.as_view(), name="profile-avatar-options"),
    path("notifications/preferences/", NotificationPreferenceView.as_view(), name="notification-preferences"),
    # Movies
    path("movies/watchlist/", MovieWatchlistView.as_view(), name="movies-watchlist"),
    path("movies/watch-state/toggle/", MovieWatchStateToggleView.as_view(), name="movies-toggle"),
    path("movies/add/", MovieAddView.as_view(), name="movies-add"),
    # Data Import/Export
    path("import/tvtime/", TVTimeImportView.as_view(), name="import-tvtime"),
    path(
        "import/status/<uuid:job_id>/",
        ImportJobStatusView.as_view(),
        name="import-status",
    ),
    # Search / TMDB proxy
    path("discover/feed/", DiscoverFeedView.as_view(), name="discover-feed"),
    path("discover/filter/", DiscoverFilterView.as_view(), name="discover-filter"),
    path("discover/genres/", DiscoverGenresView.as_view(), name="discover-genres"),
    path("search/shows/", ShowSearchView.as_view(), name="search-shows"),
    path("search/universal/", UniversalSearchView.as_view(), name="search-universal"),
    path("shows/<int:tmdb_id>/", ShowDetailView.as_view(), name="show-detail"),
    path(
        "shows/<int:tmdb_id>/season/<int:season_number>/",
        SeasonEpisodesView.as_view(),
        name="season-episodes",
    ),
    path("episodes/<int:episode_id>/", EpisodeDetailView.as_view(), name="episode-detail"),
    path(
        "episodes/<int:episode_id>/credits/",
        EpisodeCreditsView.as_view(),
        name="episode-credits",
    ),
    path("shows/<int:tmdb_id>/credits/", ShowCreditsView.as_view(), name="show-credits"),
    path(
        "shows/<int:tmdb_id>/recommendations/",
        ShowRecommendationsView.as_view(),
        name="show-recommendations",
    ),
    path(
        "shows/<int:tmdb_id>/watch-providers/",
        WatchProvidersView.as_view(),
        name="watch-providers",
    ),
    # Community & Social
    path("", include("core.comment_urls")),
    # Analytics & Insights
    path("", include("core.analytics_urls")),
    # Movie Detail Suite (TMDB proxy)
    path("movies/<int:tmdb_id>/detail/", MovieDetailView.as_view(), name="movie-detail"),
    path("movies/<int:tmdb_id>/credits/", MovieCreditsView.as_view(), name="movie-credits"),
    path("movies/<int:tmdb_id>/watch-providers/", MovieWatchProvidersView.as_view(), name="movie-providers"),
    path("movies/<int:tmdb_id>/recommendations/", MovieRecommendationsView.as_view(), name="movie-recommendations"),
]