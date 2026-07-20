"""
backend/core/auth_views.py

JWT-based registration, login, and logout. Login reuses SimpleJWT's
TokenObtainPairView machinery via a thin custom serializer so the
response also carries the caller's profile, saving the mobile client a
second round trip right after authenticating.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

from core.password_reset import confirm_reset, request_otp, verify_otp
from core.serializers import UserProfileSerializer
from core.social_auth import (
    get_or_create_social_user,
    verify_apple_id_token,
    verify_google_id_token,
)

User = get_user_model()


class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ["username", "email", "password"]

    def validate_username(self, value: str) -> str:
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is already taken.")
        return value

    def validate_email(self, value: str) -> str:
        if value and User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("That email is already registered.")
        return value

    def validate_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value

    def create(self, validated_data: dict) -> User:
        return User.objects.create_user(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            password=validated_data["password"],
        )


class RegisterView(APIView):
    """POST /api/auth/register/"""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()

        refresh = RefreshToken.for_user(user)
        profile_serializer = UserProfileSerializer(user.profile)

        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "profile": profile_serializer.data,
            },
            status=status.HTTP_201_CREATED,
        )


class GlixTokenObtainSerializer(TokenObtainPairSerializer):
    def validate(self, attrs: dict) -> dict:
        data = super().validate(attrs)
        data["profile"] = UserProfileSerializer(self.user.profile).data
        return data


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/"""

    permission_classes = [AllowAny]
    serializer_class = GlixTokenObtainSerializer


class LogoutView(APIView):
    """
    POST /api/auth/logout/
    Body: {"refresh": "<refresh_token>"}
    Blacklists the refresh token so it can no longer mint new access
    tokens; the client is responsible for discarding its stored copy.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        refresh_token = request.data.get("refresh")
        if not refresh_token:
            return Response(
                {"detail": "refresh token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except TokenError:
            return Response(
                {"detail": "Token is invalid or already blacklisted."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(status=status.HTTP_205_RESET_CONTENT)


class SocialLoginSerializer(serializers.Serializer):
    id_token = serializers.CharField()
    # Apple-only, and only ever populated on the user's FIRST
    # authorization — the native credential omits them on every sign-in
    # after that. Harmless no-ops for Google, which never sends these.
    first_name = serializers.CharField(required=False, allow_blank=True, default="")
    last_name = serializers.CharField(required=False, allow_blank=True, default="")


class SocialLoginView(APIView):
    """
    Shared verify + get-or-create + token-mint logic for Google/Apple
    sign-in. Not routed directly — see GoogleLoginView/AppleLoginView.
    """

    permission_classes = [AllowAny]
    verify_fn = staticmethod(lambda id_token: None)

    def post(self, request):
        serializer = SocialLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        identity = self.verify_fn(serializer.validated_data["id_token"])
        user, created = get_or_create_social_user(
            identity,
            first_name=serializer.validated_data["first_name"],
            last_name=serializer.validated_data["last_name"],
        )

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "profile": UserProfileSerializer(user.profile).data,
                "created": created,
            },
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class GoogleLoginView(SocialLoginView):
    """POST /api/auth/google/"""

    verify_fn = staticmethod(verify_google_id_token)


class AppleLoginView(SocialLoginView):
    """POST /api/auth/apple/"""

    verify_fn = staticmethod(verify_apple_id_token)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetRequestView(APIView):
    """
    POST /api/auth/password-reset/request/
    Body: {"email": "..."}
    Always responds 200 with a generic message, whether or not the email
    is registered — otherwise this endpoint could be used to enumerate
    accounts by email.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request_otp(serializer.validated_data["email"])
        return Response(
            {"detail": "If that email is registered, a verification code has been sent."},
            status=status.HTTP_200_OK,
        )


class PasswordResetVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    code = serializers.CharField(min_length=6, max_length=6)


class PasswordResetVerifyView(APIView):
    """
    POST /api/auth/password-reset/verify/
    Body: {"email": "...", "code": "123456"}
    Returns a short-lived one-time reset_token for PasswordResetConfirmView.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reset_token = verify_otp(
            serializer.validated_data["email"], serializer.validated_data["code"]
        )
        return Response({"reset_token": reset_token}, status=status.HTTP_200_OK)


class PasswordResetConfirmSerializer(serializers.Serializer):
    reset_token = serializers.CharField()
    new_password = serializers.CharField(min_length=8)

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages))
        return value


class PasswordResetConfirmView(APIView):
    """
    POST /api/auth/password-reset/confirm/
    Body: {"reset_token": "...", "new_password": "..."}
    Sets the new password and mints a fresh token pair so the client can
    go straight back into the app, matching RegisterView/LoginView's envelope.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = confirm_reset(
            serializer.validated_data["reset_token"], serializer.validated_data["new_password"]
        )

        refresh = RefreshToken.for_user(user)
        return Response(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "profile": UserProfileSerializer(user.profile).data,
            },
            status=status.HTTP_200_OK,
        )