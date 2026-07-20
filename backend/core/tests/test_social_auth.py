import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.test import APIClient

from core import auth_views, social_auth
from core.models import SocialAccount
from core.social_auth import VerifiedIdentity, get_or_create_social_user

User = get_user_model()


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def rsa_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private_key, private_key.public_key()


def _sign(private_key, claims: dict) -> str:
    return jwt.encode(claims, private_key, algorithm="RS256", headers={"kid": "test-kid"})


def _base_claims(**overrides) -> dict:
    now = int(time.time())
    claims = {
        "sub": "provider-user-123",
        "email": "person@example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
        "aud": "test-audience",
        "iss": "https://accounts.google.com",
    }
    claims.update(overrides)
    return claims


def _patch_jwk_client(monkeypatch, client_attr: str, public_key):
    monkeypatch.setattr(
        getattr(social_auth, client_attr),
        "get_signing_key_from_jwt",
        lambda token: SimpleNamespace(key=public_key),
    )


# ---------------------------------------------------------------------
# Token verification
# ---------------------------------------------------------------------


@pytest.mark.django_db
def test_verify_google_id_token_valid(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    settings.GOOGLE_OAUTH_CLIENT_IDS = ["test-audience"]
    _patch_jwk_client(monkeypatch, "_google_jwk_client", public_key)

    token = _sign(private_key, _base_claims())
    identity = social_auth.verify_google_id_token(token)

    assert identity.provider == SocialAccount.Provider.GOOGLE
    assert identity.sub == "provider-user-123"
    assert identity.email == "person@example.com"
    assert identity.email_verified is True


@pytest.mark.django_db
def test_verify_google_id_token_wrong_audience(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    settings.GOOGLE_OAUTH_CLIENT_IDS = ["real-audience"]
    _patch_jwk_client(monkeypatch, "_google_jwk_client", public_key)

    token = _sign(private_key, _base_claims(aud="wrong-audience"))
    with pytest.raises(AuthenticationFailed):
        social_auth.verify_google_id_token(token)


@pytest.mark.django_db
def test_verify_google_id_token_wrong_issuer(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    settings.GOOGLE_OAUTH_CLIENT_IDS = ["test-audience"]
    _patch_jwk_client(monkeypatch, "_google_jwk_client", public_key)

    token = _sign(private_key, _base_claims(iss="https://evil.example.com"))
    with pytest.raises(AuthenticationFailed):
        social_auth.verify_google_id_token(token)


@pytest.mark.django_db
def test_verify_google_id_token_expired(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    settings.GOOGLE_OAUTH_CLIENT_IDS = ["test-audience"]
    _patch_jwk_client(monkeypatch, "_google_jwk_client", public_key)

    now = int(time.time())
    token = _sign(private_key, _base_claims(iat=now - 7200, exp=now - 3600))
    with pytest.raises(AuthenticationFailed):
        social_auth.verify_google_id_token(token)


@pytest.mark.django_db
def test_verify_google_id_token_tampered_signature(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    other_private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    settings.GOOGLE_OAUTH_CLIENT_IDS = ["test-audience"]
    _patch_jwk_client(monkeypatch, "_google_jwk_client", public_key)

    # Signed with a DIFFERENT private key than the one whose public key
    # verification is pinned to — must fail signature verification.
    token = _sign(other_private_key, _base_claims())
    with pytest.raises(AuthenticationFailed):
        social_auth.verify_google_id_token(token)


@pytest.mark.django_db
def test_verify_apple_id_token_email_verified_string_true(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    settings.APPLE_AUDIENCES = ["com.watchtracker.app"]
    _patch_jwk_client(monkeypatch, "_apple_jwk_client", public_key)

    token = _sign(
        private_key,
        _base_claims(
            aud="com.watchtracker.app",
            iss="https://appleid.apple.com",
            email_verified="true",  # Apple sometimes sends this as a string
        ),
    )
    identity = social_auth.verify_apple_id_token(token)
    assert identity.email_verified is True


@pytest.mark.django_db
def test_verify_apple_id_token_email_verified_string_false(monkeypatch, rsa_keypair, settings):
    private_key, public_key = rsa_keypair
    settings.APPLE_AUDIENCES = ["com.watchtracker.app"]
    _patch_jwk_client(monkeypatch, "_apple_jwk_client", public_key)

    token = _sign(
        private_key,
        _base_claims(
            aud="com.watchtracker.app",
            iss="https://appleid.apple.com",
            email_verified="false",
        ),
    )
    identity = social_auth.verify_apple_id_token(token)
    assert identity.email_verified is False


# ---------------------------------------------------------------------
# get_or_create_social_user
# ---------------------------------------------------------------------


@pytest.mark.django_db
def test_get_or_create_new_user_has_unusable_password():
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.GOOGLE,
        sub="sub-1",
        email="newperson@example.com",
        email_verified=True,
    )
    user, created = get_or_create_social_user(identity, first_name="New", last_name="Person")

    assert created is True
    assert user.has_usable_password() is False
    assert user.first_name == "New"
    assert SocialAccount.objects.filter(provider="google", provider_user_id="sub-1", user=user).exists()


@pytest.mark.django_db
def test_get_or_create_repeat_login_is_idempotent():
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.GOOGLE, sub="sub-2", email="repeat@example.com", email_verified=True
    )
    user1, created1 = get_or_create_social_user(identity)
    user2, created2 = get_or_create_social_user(identity)

    assert created1 is True
    assert created2 is False
    assert user1.pk == user2.pk
    assert SocialAccount.objects.filter(provider="google", provider_user_id="sub-2").count() == 1


@pytest.mark.django_db
def test_get_or_create_links_verified_email_to_existing_account():
    existing = User.objects.create_user(username="existinguser", email="linkme@example.com", password="pw12345678")
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.APPLE, sub="sub-3", email="linkme@example.com", email_verified=True
    )
    user, created = get_or_create_social_user(identity)

    assert created is False
    assert user.pk == existing.pk
    assert SocialAccount.objects.filter(provider="apple", provider_user_id="sub-3", user=existing).exists()


@pytest.mark.django_db
def test_get_or_create_does_not_link_unverified_email():
    existing = User.objects.create_user(username="existinguser2", email="unverified@example.com", password="pw12345678")
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.APPLE, sub="sub-4", email="unverified@example.com", email_verified=False
    )
    user, created = get_or_create_social_user(identity)

    # Security-relevant: must NOT silently take over an existing account
    # just because an unverified claim happens to match its email.
    assert created is True
    assert user.pk != existing.pk


@pytest.mark.django_db
def test_get_or_create_deduplicates_username_collisions():
    User.objects.create_user(username="samename", password="pw12345678")
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.GOOGLE, sub="sub-5", email="samename@example.com", email_verified=True
    )
    user, created = get_or_create_social_user(identity)

    assert created is True
    assert user.username != "samename"
    assert user.username.startswith("samename")


# ---------------------------------------------------------------------
# Views (verify_fn monkeypatched — never touches real JWKS)
# ---------------------------------------------------------------------


@pytest.mark.django_db
def test_google_login_view_new_user(api_client, monkeypatch):
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.GOOGLE, sub="view-sub-1", email="viewuser@example.com", email_verified=True
    )
    monkeypatch.setattr(auth_views.GoogleLoginView, "verify_fn", staticmethod(lambda token: identity))

    url = reverse("auth-google")
    response = api_client.post(url, {"id_token": "irrelevant-because-mocked"})

    assert response.status_code == 201
    assert response.data["created"] is True
    assert "access" in response.data and "refresh" in response.data
    assert "profile" in response.data


@pytest.mark.django_db
def test_google_login_view_returning_user(api_client, monkeypatch):
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.GOOGLE, sub="view-sub-2", email="returning@example.com", email_verified=True
    )
    get_or_create_social_user(identity)  # pre-create
    monkeypatch.setattr(auth_views.GoogleLoginView, "verify_fn", staticmethod(lambda token: identity))

    url = reverse("auth-google")
    response = api_client.post(url, {"id_token": "irrelevant-because-mocked"})

    assert response.status_code == 200
    assert response.data["created"] is False


@pytest.mark.django_db
def test_apple_login_view_forwards_name_on_first_authorization(api_client, monkeypatch):
    identity = VerifiedIdentity(
        provider=SocialAccount.Provider.APPLE, sub="view-sub-3", email="apple@example.com", email_verified=True
    )
    monkeypatch.setattr(auth_views.AppleLoginView, "verify_fn", staticmethod(lambda token: identity))

    url = reverse("auth-apple")
    response = api_client.post(
        url, {"id_token": "irrelevant-because-mocked", "first_name": "Ada", "last_name": "Lovelace"}
    )

    assert response.status_code == 201
    user = User.objects.get(email="apple@example.com")
    assert user.first_name == "Ada"
    assert user.last_name == "Lovelace"
