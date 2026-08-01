"""
backend/core/dates.py

Small shared date helpers. `has_released()` is the backend counterpart of
the client's `lib/dateFormat.ts::hasAired()` — both encode the same rule
("a null/undated item has not released; a future-dated item has not
released either") so the gate reads identically on both sides instead of
being hand-inlined as `x.field is None or x.field > today` at each call
site.
"""

from datetime import date
from typing import Optional

from django.utils import timezone


def has_released(date_value: Optional[date]) -> bool:
    """Whether an air_date/release_date is today or in the past.

    A null date (TMDB hasn't dated the item yet) counts as "not released",
    never as "released" — the same rule `hasAired()` applies on the client.
    """
    if date_value is None:
        return False
    return date_value <= timezone.now().date()
