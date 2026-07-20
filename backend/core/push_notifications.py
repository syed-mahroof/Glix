"""
backend/core/push_notifications.py

Sends push notifications through Expo's push service
(https://exp.host/--/api/v2/push/send). This is the piece that was
missing end-to-end: NotificationPreference already stored a push_token
and the two boolean flags, but nothing ever read them to actually send
anything. core/tasks.py calls into notify_users() below when a new
episode airs or the weekly digest fires.

Expo's HTTP API takes up to 100 messages per request and returns one
receipt per message in the same order. A DeviceNotRegistered receipt
means the token is dead (app uninstalled, etc.) — we clear it so future
runs don't keep paying for a doomed request.
"""

import logging

import requests

from core.models import NotificationPreference

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
EXPO_PUSH_BATCH_SIZE = 100


def _chunk(items, size):
    for i in range(0, len(items), size):
        yield items[i : i + size]


def notify_users(user_ids, title: str, body: str, data: dict | None = None, preference_field: str | None = None):
    """
    Push `title`/`body` to every user in `user_ids` who has a push_token
    on file, optionally gated on a NotificationPreference boolean field
    (e.g. "notify_new_episode"). Silently no-ops for users with no token
    or an opted-out preference — never raises for those.
    """
    prefs_qs = NotificationPreference.objects.filter(
        user_id__in=user_ids, push_token__isnull=False
    ).exclude(push_token="")
    if preference_field:
        prefs_qs = prefs_qs.filter(**{preference_field: True})

    prefs = list(prefs_qs.only("id", "user_id", "push_token"))
    if not prefs:
        return

    messages = [
        {
            "to": pref.push_token,
            "title": title,
            "body": body,
            "sound": "default",
            "data": data or {},
        }
        for pref in prefs
    ]

    _send_and_clear_dead_tokens(messages, prefs)


def _send_and_clear_dead_tokens(messages, prefs):
    dead_pref_ids = []

    for message_batch, pref_batch in zip(_chunk(messages, EXPO_PUSH_BATCH_SIZE), _chunk(prefs, EXPO_PUSH_BATCH_SIZE)):
        try:
            response = requests.post(
                EXPO_PUSH_URL,
                json=message_batch,
                headers={"Accept": "application/json", "Content-Type": "application/json"},
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            logger.warning("Expo push send failed for a batch of %d: %s", len(message_batch), exc)
            continue

        receipts = (response.json() or {}).get("data") or []
        for receipt, pref in zip(receipts, pref_batch):
            if receipt.get("status") == "error" and receipt.get("details", {}).get("error") == "DeviceNotRegistered":
                dead_pref_ids.append(pref.id)

    if dead_pref_ids:
        NotificationPreference.objects.filter(id__in=dead_pref_ids).update(push_token=None)
        logger.info("Cleared %d dead Expo push token(s).", len(dead_pref_ids))
