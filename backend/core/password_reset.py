"""
backend/core/password_reset.py

OTP-based forgot-password flow. Codes and one-time reset tokens live in
Django's cache framework (settings.CACHES["default"], already backed by
Redis for TMDB caching/throttling) — no new model/migration needed since
everything here is short-lived by design. Email delivery goes through
Django's send_mail using the Gmail SMTP settings in config/settings/base.py.
"""

import hashlib
import secrets

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.mail import send_mail
from django.utils.crypto import get_random_string
from rest_framework.exceptions import Throttled, ValidationError

User = get_user_model()

OTP_TTL_SECONDS = 600  # 10 minutes
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
RESET_TOKEN_TTL_SECONDS = 600


def _otp_key(email: str) -> str:
    return f"pwreset:otp:{email.lower()}"


def _cooldown_key(email: str) -> str:
    return f"pwreset:cooldown:{email.lower()}"


def _token_key(token: str) -> str:
    return f"pwreset:token:{token}"


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def request_otp(email: str) -> None:
    """
    Generates + emails a 6-digit OTP for `email` if (and only if) an
    active account with that email exists. Silent no-op otherwise —
    callers must always return the same generic response either way, so
    this endpoint can't be used to enumerate registered emails.
    """
    if cache.get(_cooldown_key(email)) is not None:
        raise Throttled(detail="Please wait a minute before requesting another code.")

    user = User.objects.filter(email__iexact=email, is_active=True).first()
    # Always set the cooldown, whether or not the user exists, so a
    # nonexistent-email probe can't be distinguished from a real one by
    # its absence of a resend-cooldown either.
    cache.set(_cooldown_key(email), True, timeout=OTP_RESEND_COOLDOWN_SECONDS)
    if user is None:
        return

    code = f"{secrets.randbelow(1_000_000):06d}"
    cache.set(
        _otp_key(email),
        {"hash": _hash_code(code), "attempts": 0, "user_id": user.id},
        timeout=OTP_TTL_SECONDS,
    )
    send_mail(
        subject="Your Glix verification code",
        message=(
            f"Your Glix password reset code is {code}.\n\n"
            "It expires in 10 minutes. If you didn't request this, you can ignore this email."
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
        fail_silently=False,
        html_message=_render_otp_email_html(code),
    )


def _render_otp_email_html(code: str) -> str:
    """
    Table-based, all-inline-style layout (no <style> block, no flexbox/grid)
    since this has to survive Gmail/Outlook's stripped-down HTML renderers,
    not a real browser. Colors match client-mobile/lib/theme.ts's dark
    theme exactly (`bg` #000000, `accentFill`/`accentInk` #E4FA1A, `onAccent`
    #000000, `textPrimary` #FFFFFF, `textSecondary` rgba(255,255,255,.60)) —
    the one hardcoded palette in the codebase outside that file, deliberately
    kept in sync with it rather than importing (this is Python, not TS).
    """
    spaced_code = " ".join(code)
    return f"""\
<!DOCTYPE html>
<html>
  <body style="margin:0; padding:0; background-color:#000000; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#000000; padding:40px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#0A0A0A; border:1px solid rgba(255,255,255,0.12); border-radius:20px; overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px; text-align:center;">
                <span style="font-size:24px; font-weight:800; letter-spacing:-0.5px; color:#FFFFFF;">Gl<span style="color:#E4FA1A;">ix</span></span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px; text-align:center;">
                <p style="margin:0; font-size:18px; font-weight:700; color:#FFFFFF;">Reset your password</p>
                <p style="margin:8px 0 0 0; font-size:14px; line-height:20px; color:rgba(255,255,255,0.60);">
                  Use this code to verify it's you. It expires in 10 minutes.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#E4FA1A; border-radius:14px;">
                  <tr>
                    <td style="padding:18px 12px; text-align:center;">
                      <span style="font-size:32px; font-weight:800; letter-spacing:10px; color:#000000; font-family:'Courier New',monospace;">{spaced_code}</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px 32px; text-align:center;">
                <p style="margin:0; font-size:13px; line-height:18px; color:rgba(255,255,255,0.60);">
                  Didn't request this? You can safely ignore this email — your password won't change.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px; border-top:1px solid rgba(255,255,255,0.12); text-align:center;">
                <p style="margin:0; font-size:11px; color:rgba(255,255,255,0.40);">Glix &middot; Track every show and movie you watch</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def verify_otp(email: str, code: str) -> str:
    """
    Checks `code` against the pending OTP for `email`. On success,
    consumes the OTP (single use) and returns a fresh one-time reset
    token the client exchanges for an actual password change via
    confirm_reset(). Raises ValidationError on any failure.
    """
    key = _otp_key(email)
    data = cache.get(key)
    if data is None:
        raise ValidationError({"detail": "Code expired or invalid. Request a new one."})

    if data["attempts"] >= OTP_MAX_ATTEMPTS:
        cache.delete(key)
        raise ValidationError({"detail": "Too many incorrect attempts. Request a new code."})

    if _hash_code(code) != data["hash"]:
        data["attempts"] += 1
        cache.set(key, data, timeout=OTP_TTL_SECONDS)
        raise ValidationError({"detail": "Incorrect code."})

    cache.delete(key)
    token = get_random_string(48)
    cache.set(_token_key(token), {"user_id": data["user_id"]}, timeout=RESET_TOKEN_TTL_SECONDS)
    return token


def confirm_reset(token: str, new_password: str) -> User:
    """Consumes a reset token minted by verify_otp() and sets the new password."""
    key = _token_key(token)
    data = cache.get(key)
    if data is None:
        raise ValidationError({"detail": "This reset session has expired. Start over."})

    cache.delete(key)
    user = User.objects.get(id=data["user_id"])
    user.set_password(new_password)
    user.save(update_fields=["password"])
    return user
