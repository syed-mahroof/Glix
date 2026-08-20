"""
backend/core/dates.py

Small shared date helpers. `has_released()` is the backend counterpart of
the client's `lib/dateFormat.ts::hasAired()` — both encode the same rule
("a null/undated item has not released; a future-dated item has not
released either") so the gate reads identically on both sides instead of
being hand-inlined as `x.field is None or x.field > today` at each call
site.
"""

from datetime import date, timedelta
from typing import Optional

from django.utils import timezone

# Bug fix (2026-08-21, "mark previous episodes modal pops after the show
# already shows complete"): the server computed "has this aired" off
# timezone.now().date() — UTC, since TIME_ZONE="UTC" — while the client's
# hasAired() (lib/dateFormat.ts) uses the DEVICE's local calendar date. For a
# user east of UTC (IST, UTC+5:30, or further), local midnight arrives before
# UTC midnight, so the client already counts an episode as aired while the
# server still doesn't. That gap put an episode on both sides of a
# disagreement at once: the client's optimistic mark-watched (and its
# completion/confetti check) treated it as aired, while
# BulkWatchStateToggleView / CatchupCheckView — server-authoritative — did
# not, silently dropping it into skipped_unaired_ids and leaving it eligible
# to resurface in a later Catch-Up check as "still unwatched" even after the
# show already reads as 100% complete on the client.
#
# UTC+14 (Kiribati) is the furthest-ahead real timezone offset, so widening
# the server's cutoff by that much guarantees it is never STRICTER than any
# client's local calendar date could be — the server may now treat a handful
# of hours as "aired" slightly before a user further west would call it that
# themselves, which is harmless for content that has, in fact, already
# aired. Narrowing the gap the other way (making the client compute UTC
# instead of local) was rejected: that would refuse a same-night mark-watched
# for every user east of UTC, which is most of the affected user base.
AIRED_DATE_GRACE = timedelta(hours=14)


def aired_cutoff_date() -> date:
    """The calendar date to compare an air_date/release_date against when
    deciding "has this released yet" — server-side "today", widened by
    AIRED_DATE_GRACE so it's never stricter than any client's local date.
    Single source of truth for every `air_date__lte=<cutoff>` queryset
    filter and has_released() call in the backend; see the grace constant's
    own comment for why the widening exists."""
    return (timezone.now() + AIRED_DATE_GRACE).date()


def has_released(date_value: Optional[date]) -> bool:
    """Whether an air_date/release_date is today or in the past.

    A null date (TMDB hasn't dated the item yet) counts as "not released",
    never as "released" — the same rule `hasAired()` applies on the client.
    """
    if date_value is None:
        return False
    return date_value <= aired_cutoff_date()
