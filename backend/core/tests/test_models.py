import pytest
from django.contrib.auth import get_user_model
from core.models import UserProfile, WatchStreak

User = get_user_model()

@pytest.mark.django_db
def test_user_profile_creation():
    user = User.objects.create_user(username="testuser", password="password")
    profile = UserProfile.objects.get(user=user)
    profile.total_time_watched = 120
    profile.save()
    
    assert profile.user == user
    assert profile.total_time_watched == 120
    assert str(profile) == "Profile<testuser>"

@pytest.mark.django_db
def test_watch_streak_creation():
    user = User.objects.create_user(username="testuser2", password="password")
    streak = WatchStreak.objects.create(user=user, current_streak=5, longest_streak=10)
    
    assert streak.user == user
    assert streak.current_streak == 5
    assert streak.longest_streak == 10
    assert str(streak) == "Streak<testuser2, current=5>"
