"""
backend/core/social_auth.py

Server-side verification of Google/Apple "Sign in with" ID tokens, plus
the get-or-create-or-link logic that turns a verified identity into a
Django User. The mobile app is the OAuth client (native SDK obtains the
ID token on-device); this module's only job is to check that token's
signature/issuer/audience/expiry against the provider's published JWKS
and resolve it to a local user for GoogleLoginView/AppleLoginView
(auth_views.py) to mint SimpleJWT tokens for. Uses PyJWT's PyJWKClient
(PyJWT is already pinned for SimpleJWT-adjacent use; this only adds its
`cryptography` RS256 backend, not a new auth package).
"""

import re
from dataclasses import dataclass

import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.utils.crypto import get_random_string
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientError
from rest_framework.exceptions import APIException, AuthenticationFailed

from core.models import SocialAccount

User = get_user_model()

GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"]

APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"

# Module-level singletons: PyJWKClient caches the fetched JWKS for
# `lifespan` seconds (default 300) and caches individual keys by `kid`
# when cache_keys=True, so this is at most one outbound HTTP call per
# provider every ~5 minutes, not a per-login network dependency.
_google_jwk_client = PyJWKClient(GOOGLE_JWKS_URL, cache_keys=True)
_apple_jwk_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True)

_USERNAME_SANITIZE_RE = re.compile(r"[^\w.@+-]")


class ProviderUnavailable(APIException):
    status_code = 503
    default_detail = "Unable to reach the sign-in provider right now. Please try again shortly."
    default_code = "provider_unavailable"


@dataclass(frozen=True)
class VerifiedIdentity:
    provider: str
    sub: str
    email: str
    email_verified: bool


def verify_google_id_token(id_token: str) -> VerifiedIdentity:
    try:
        signing_key = _google_jwk_client.get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.GOOGLE_OAUTH_CLIENT_IDS,
            issuer=GOOGLE_ISSUERS,
        )
    except PyJWKClientError as exc:
        raise ProviderUnavailable() from exc
    except jwt.PyJWTError as exc:
        raise AuthenticationFailed(f"Invalid Google credential: {exc}") from exc

    return VerifiedIdentity(
        provider=SocialAccount.Provider.GOOGLE,
        sub=claims["sub"],
        email=claims.get("email", ""),
        email_verified=bool(claims.get("email_verified", False)),
    )


def verify_apple_id_token(id_token: str) -> VerifiedIdentity:
    try:
        signing_key = _apple_jwk_client.get_signing_key_from_jwt(id_token)
        claims = jwt.decode(
            id_token,
            signing_key.key,
            algorithms=["RS256"],
            audience=settings.APPLE_AUDIENCES,
            issuer=APPLE_ISSUER,
        )
    except PyJWKClientError as exc:
        raise ProviderUnavailable() from exc
    except jwt.PyJWTError as exc:
        raise AuthenticationFailed(f"Invalid Apple credential: {exc}") from exc

    # Apple has shipped "true"/"false" as literal strings for
    # email_verified on some token versions, not JSON booleans —
    # normalize defensively rather than trusting the claim's type.
    email_verified = str(claims.get("email_verified", False)).lower() == "true"

    return VerifiedIdentity(
        provider=SocialAccount.Provider.APPLE,
        sub=claims["sub"],
        email=claims.get("email", ""),
        email_verified=email_verified,
    )


def generate_unique_username(seed: str, fallback_prefix: str) -> str:
    base = _USERNAME_SANITIZE_RE.sub("", seed.split("@")[0])[:20] or fallback_prefix
    candidate = base
    suffix = 0
    while User.objects.filter(username__iexact=candidate).exists():
        suffix += 1
        candidate = f"{base}{suffix}" if suffix <= 9999 else f"{base}{get_random_string(6)}"
    return candidate


def get_or_create_social_user(
    identity: VerifiedIdentity, first_name: str = "", last_name: str = ""
) -> tuple[User, bool]:
    """
    Returns (user, created). `created` is True only when a brand-new
    Glix account was minted — not when an existing account was
    merely linked to a newly-seen provider.
    """
    existing = (
        SocialAccount.objects.select_related("user")
        .filter(provider=identity.provider, provider_user_id=identity.sub)
        .first()
    )
    if existing is not None:
        return existing.user, False

    # Link to an existing password account ONLY when the provider itself
    # asserts the email is verified — trusting an unverified email claim
    # for account linking is an account-takeover vector.
    linked_user = None
    if identity.email and identity.email_verified:
        matches = list(User.objects.filter(email__iexact=identity.email, is_active=True)[:2])
        if len(matches) == 1:
            linked_user = matches[0]

    if linked_user is not None:
        SocialAccount.objects.get_or_create(
            provider=identity.provider,
            provider_user_id=identity.sub,
            defaults={"user": linked_user, "email": identity.email},
        )
        return linked_user, False

    username = generate_unique_username(
        identity.email or identity.sub, fallback_prefix=f"{identity.provider}_user"
    )
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                username=username,
                email=identity.email or "",
                password=None,  # make_password(None) => unusable password hash
                first_name=first_name,
                last_name=last_name,
            )
            SocialAccount.objects.create(
                user=user,
                provider=identity.provider,
                provider_user_id=identity.sub,
                email=identity.email or "",
            )
    except IntegrityError:
        # Lost a race with a concurrent request bearing the same
        # provider+sub (double-tap/retry) — the unique constraint already
        # recorded the other request's user; treat this as existing-login.
        existing = SocialAccount.objects.select_related("user").get(
            provider=identity.provider, provider_user_id=identity.sub
        )
        return existing.user, False

    return user, True
