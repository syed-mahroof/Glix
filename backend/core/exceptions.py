"""
backend/core/exceptions.py

Wraps DRF's default exception handler to return a consistent
{"detail": ..., "code": ...} envelope. Field-level validation errors
(e.g. {"username": ["already taken"]}) are folded into a readable
`detail` string instead of being discarded, and also preserved
verbatim under `errors` for clients that want structured access.
Anything DRF doesn't already handle (uncaught exceptions) still comes
back as JSON instead of an HTML 500 page.
"""

import logging

from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = logging.getLogger(__name__)


def _flatten_field_errors(errors: dict) -> str:
    messages = []
    for field, field_errors in errors.items():
        if isinstance(field_errors, (list, tuple)):
            for message in field_errors:
                messages.append(f"{field}: {message}")
        else:
            messages.append(f"{field}: {field_errors}")
    return "; ".join(messages) if messages else "An error occurred."


def custom_exception_handler(exc, context):
    response = drf_exception_handler(exc, context)

    if response is not None:
        errors = None

        if isinstance(response.data, dict) and "detail" in response.data:
            detail = response.data["detail"]
        elif isinstance(response.data, dict):
            # Field-level validation error shape, e.g. RegisterSerializer's
            # {"username": ["That username is already taken."]}.
            errors = response.data
            detail = _flatten_field_errors(errors)
        elif isinstance(response.data, list):
            detail = "; ".join(str(item) for item in response.data) or "An error occurred."
        else:
            detail = str(response.data) if response.data is not None else "An error occurred."

        payload = {"detail": detail, "code": response.status_code}
        if errors is not None:
            payload["errors"] = errors
        response.data = payload
        return response

    logger.exception("Unhandled exception in %s", context.get("view"))
    return Response(
        {"detail": "An unexpected server error occurred.", "code": 500},
        status=500,
    )