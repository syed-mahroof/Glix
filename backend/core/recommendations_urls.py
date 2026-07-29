"""
backend/core/recommendations_urls.py

URL patterns for cross-library personalized recommendations. Included
from core/urls.py with the same pattern used for lists_urls.py/analytics_urls.py.
"""

from django.urls import path

from core.recommendations_views import ForYouRecommendationsView

urlpatterns = [
    path("recommendations/for-you/", ForYouRecommendationsView.as_view(), name="recommendations-for-you"),
]
