"""
backend/core/tests/test_dates.py

Regression coverage for the AIRED_DATE_GRACE fix (Phase 85, Batch A/E) —
"mark previous episodes modal pops after the show already shows complete".
No time-mocking dependency (freezegun isn't used anywhere else in this
suite): every assertion here is relative to the real `timezone.now()` at
test-run time, which is deterministic without needing to freeze it.
"""

from datetime import timedelta

import pytest
from django.utils import timezone

from core.dates import AIRED_DATE_GRACE, aired_cutoff_date, has_released


def test_aired_date_grace_is_fourteen_hours():
    # UTC+14 (Kiribati) is the furthest-ahead real timezone offset — see
    # this constant's own comment in core/dates.py for why that's the bound.
    assert AIRED_DATE_GRACE == timedelta(hours=14)


def test_aired_cutoff_date_is_never_earlier_than_today():
    # The whole point of the grace period: the server's cutoff must never
    # be STRICTER (earlier) than plain UTC "today" — only ever equal or
    # later, so a client anywhere in the world sees at least what the
    # server sees.
    assert aired_cutoff_date() >= timezone.now().date()


def test_aired_cutoff_date_matches_grace_widened_now():
    # Exact relationship, not just a loose bound — this is the actual
    # mechanism (widen `now`, then take its date), so it should hold to
    # the minute regardless of what time this test happens to run at.
    expected = (timezone.now() + AIRED_DATE_GRACE).date()
    assert aired_cutoff_date() == expected


def test_has_released_true_for_a_date_slightly_in_the_future():
    # This is the actual bug this fix closes: an episode whose air_date is
    # already "past" for a user east of UTC (India, at minimum) but not
    # yet past in plain UTC. Something dated a few hours into the future
    # relative to raw UTC must still read as released, within the grace
    # window.
    near_future = (timezone.now() + timedelta(hours=6)).date()
    assert has_released(near_future) is True


def test_has_released_false_for_a_date_well_beyond_the_grace_window():
    far_future = (timezone.now() + timedelta(days=2)).date()
    assert has_released(far_future) is False


def test_has_released_false_for_none():
    # A null date (TMDB hasn't dated the item yet) is never "released" —
    # unrelated to the grace period, but the one existing behavior this
    # fix must not have disturbed.
    assert has_released(None) is False


def test_has_released_true_for_a_clearly_past_date():
    assert has_released(timezone.now().date() - timedelta(days=30)) is True
