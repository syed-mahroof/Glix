import pytest
from django.urls import reverse
from rest_framework.test import APIClient
from django.contrib.auth import get_user_model

User = get_user_model()

@pytest.fixture
def api_client():
    return APIClient()

@pytest.fixture
def create_user():
    def make_user(username="testuser", password="password"):
        return User.objects.create_user(username=username, password=password)
    return make_user

@pytest.mark.django_db
def test_login_success(api_client, create_user):
    create_user()
    url = reverse("auth-login")
    response = api_client.post(url, {"username": "testuser", "password": "password"})
    assert response.status_code == 200
    assert "access" in response.data
    assert "refresh" in response.data

@pytest.mark.django_db
def test_login_failure(api_client, create_user):
    create_user()
    url = reverse("auth-login")
    response = api_client.post(url, {"username": "testuser", "password": "wrongpassword"})
    assert response.status_code == 401
    assert "access" not in response.data

@pytest.mark.django_db
def test_watchlist_unauthenticated(api_client):
    url = reverse("watchlist")
    response = api_client.get(url)
    assert response.status_code == 401
