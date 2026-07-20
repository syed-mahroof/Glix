import re

import pytest
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.urls import reverse
from rest_framework.test import APIClient

from core import password_reset
from core.password_reset import confirm_reset, request_otp, verify_otp

User = get_user_model()


def _code_from_email(message) -> str:
    return re.search(r"\b(\d{6})\b", message.body).group(1)


@pytest.fixture(autouse=True)
def _clear_cache_and_use_locmem_email(settings):
    # OTPs/reset tokens live in the real cache backend (Redis in this
    # environment) — clear it so cooldowns/leftover keys from one test
    # can't bleed into the next. Email goes through locmem so tests never
    # touch real Gmail SMTP; django.core.mail.outbox captures it instead.
    cache.clear()
    settings.EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
    yield
    cache.clear()


@pytest.fixture
def api_client():
    return APIClient()


# ---------------------------------------------------------------------
# request_otp / verify_otp / confirm_reset (module-level)
# ---------------------------------------------------------------------


@pytest.mark.django_db
def test_request_otp_sends_email_for_existing_user():
    user = User.objects.create_user(username="hasaccount", email="hasaccount@example.com", password="pw12345678")
    request_otp(user.email)

    assert len(mail.outbox) == 1
    assert user.email in mail.outbox[0].to
    assert re.search(r"\b\d{6}\b", mail.outbox[0].body) is not None


@pytest.mark.django_db
def test_request_otp_silent_for_unknown_email():
    request_otp("nobody@example.com")
    assert len(mail.outbox) == 0


@pytest.mark.django_db
def test_request_otp_cooldown_throttles_resend():
    from rest_framework.exceptions import Throttled

    user = User.objects.create_user(username="cooldown", email="cooldown@example.com", password="pw12345678")
    request_otp(user.email)
    with pytest.raises(Throttled):
        request_otp(user.email)


@pytest.mark.django_db
def test_verify_otp_correct_code_returns_reset_token_and_consumes_it():
    user = User.objects.create_user(username="verifyok", email="verifyok@example.com", password="pw12345678")
    request_otp(user.email)
    code = _code_from_email(mail.outbox[0])

    token = verify_otp(user.email, code)
    assert token

    # OTP is single-use — a second attempt with the same (now-deleted) code fails.
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        verify_otp(user.email, code)


@pytest.mark.django_db
def test_verify_otp_wrong_code_fails_and_counts_attempt():
    from rest_framework.exceptions import ValidationError

    user = User.objects.create_user(username="wrongcode", email="wrongcode@example.com", password="pw12345678")
    request_otp(user.email)

    with pytest.raises(ValidationError):
        verify_otp(user.email, "000000")

    data = cache.get(password_reset._otp_key(user.email))
    assert data["attempts"] == 1


@pytest.mark.django_db
def test_verify_otp_locks_out_after_max_attempts():
    from rest_framework.exceptions import ValidationError

    user = User.objects.create_user(username="lockout", email="lockout@example.com", password="pw12345678")
    request_otp(user.email)
    correct_code = _code_from_email(mail.outbox[0])

    for _ in range(password_reset.OTP_MAX_ATTEMPTS):
        with pytest.raises(ValidationError):
            verify_otp(user.email, "000000")

    # Even the correct code no longer works once attempts are exhausted.
    with pytest.raises(ValidationError):
        verify_otp(user.email, correct_code)


@pytest.mark.django_db
def test_verify_otp_expired_or_missing_fails():
    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        verify_otp("never-requested@example.com", "123456")


@pytest.mark.django_db
def test_confirm_reset_sets_new_password_and_consumes_token():
    user = User.objects.create_user(username="confirmme", email="confirmme@example.com", password="oldpassword123")
    request_otp(user.email)
    code = _code_from_email(mail.outbox[0])
    token = verify_otp(user.email, code)

    updated_user = confirm_reset(token, "brandnewpassword123")
    updated_user.refresh_from_db()
    assert updated_user.check_password("brandnewpassword123") is True

    from rest_framework.exceptions import ValidationError

    with pytest.raises(ValidationError):
        confirm_reset(token, "anotherpassword123")


# ---------------------------------------------------------------------
# Views — full request/verify/confirm round trip via APIClient
# ---------------------------------------------------------------------


@pytest.mark.django_db
def test_full_password_reset_flow_via_api(api_client):
    user = User.objects.create_user(username="fullflow", email="fullflow@example.com", password="oldpassword123")

    resp = api_client.post(reverse("auth-password-reset-request"), {"email": user.email})
    assert resp.status_code == 200
    code = _code_from_email(mail.outbox[0])

    resp = api_client.post(reverse("auth-password-reset-verify"), {"email": user.email, "code": code})
    assert resp.status_code == 200
    reset_token = resp.data["reset_token"]

    resp = api_client.post(
        reverse("auth-password-reset-confirm"),
        {"reset_token": reset_token, "new_password": "brandnewpassword123"},
    )
    assert resp.status_code == 200
    assert "access" in resp.data and "refresh" in resp.data

    user.refresh_from_db()
    assert user.check_password("brandnewpassword123") is True


@pytest.mark.django_db
def test_password_reset_request_returns_200_for_unknown_email(api_client):
    # Same generic response whether or not the email is registered —
    # otherwise this endpoint leaks which emails have accounts.
    resp = api_client.post(reverse("auth-password-reset-request"), {"email": "ghost@example.com"})
    assert resp.status_code == 200
    assert len(mail.outbox) == 0


@pytest.mark.django_db
def test_password_reset_verify_wrong_code_via_api(api_client):
    user = User.objects.create_user(username="apiwrong", email="apiwrong@example.com", password="pw12345678")
    api_client.post(reverse("auth-password-reset-request"), {"email": user.email})

    resp = api_client.post(reverse("auth-password-reset-verify"), {"email": user.email, "code": "000000"})
    assert resp.status_code == 400


@pytest.mark.django_db
def test_password_reset_confirm_rejects_weak_password(api_client):
    user = User.objects.create_user(username="weakpw", email="weakpw@example.com", password="oldpassword123")
    api_client.post(reverse("auth-password-reset-request"), {"email": user.email})
    code = _code_from_email(mail.outbox[0])
    verify_resp = api_client.post(
        reverse("auth-password-reset-verify"), {"email": user.email, "code": code}
    )
    reset_token = verify_resp.data["reset_token"]

    resp = api_client.post(
        reverse("auth-password-reset-confirm"), {"reset_token": reset_token, "new_password": "123"}
    )
    assert resp.status_code == 400
