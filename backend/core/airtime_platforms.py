"""
backend/core/airtime_platforms.py

A conservative fallback for shows TVmaze has no time coverage for at
all — most streaming originals, which typically have no fixed weekly
network slot AND, for many titles, no per-episode airstamp published
either (TVmaze's per-episode `airstamp` coverage lags a title's release
by however long it takes someone to add it to TVmaze). Rather than show
nothing at all for those, this maps a handful of major streaming
platforms to their well-documented, genuinely-conventional release time
— e.g. "Netflix originals drop at midnight Pacific" is reported widely
enough (trade press, fan wikis, the platforms' own communications) to
treat as a fact about how the platform operates, not a guess about one
show.

Deliberately small and conservative: only platforms with a real,
widely-documented convention are listed here. Anything not in this
table is left with no estimated time, exactly as it was before this
module existed — core/airtime.py's founding principle ("better to show
no time than a wrong one") applies here too, so a platform whose actual
drop time varies by title/region/deal is left out rather than guessed.

Every estimate produced by this module is marked
`CachedShow.air_time_source = "platform_estimate"` rather than being
presented identically to a real TVmaze value — see core/airtime.py's
sync_show_air_time (which only ever calls into this module once TVmaze
itself has come back with nothing) and the client's formatLocalAirTime,
which prefixes a "~" onto any time sourced from here.
"""

from typing import Optional

# TMDB network name -> (wall-clock "HH:MM", IANA timezone) for that
# platform's conventional global release time. Matched against
# CachedShow.networks, which stores TMDB's own `networks[].name` strings
# verbatim, so keys here must match TMDB's naming exactly (case-sensitive).
PLATFORM_AIR_TIME_CONVENTIONS: dict[str, tuple[str, str]] = {
    # Netflix originals drop at midnight Pacific Time — a well-documented
    # global convention: every territory gets the release simultaneously
    # off one US-Pacific-anchored clock, not a local-midnight rollout per
    # region.
    "Netflix": ("00:00", "America/Los_Angeles"),
    # Apple TV+ episodes are published at midnight Pacific Time, matching
    # Apple's own release-schedule language for its originals.
    "Apple TV+": ("00:00", "America/Los_Angeles"),
    # Prime Video originals release at midnight Pacific Time, the same
    # simultaneous-global-drop convention as Netflix.
    "Amazon": ("00:00", "America/Los_Angeles"),
    "Prime Video": ("00:00", "America/Los_Angeles"),
    # Disney+ originals are conventionally published at 3:00 AM Eastern
    # (= midnight Pacific) — a deliberately different slot than Netflix's
    # midnight-PT norm, chosen to land before the US East Coast wakes up.
    "Disney+": ("03:00", "America/New_York"),
    # Hulu originals typically post at 12:00 AM Pacific, alongside its
    # simulcast/next-day network-show releases.
    "Hulu": ("00:00", "America/Los_Angeles"),
    # Max (formerly HBO Max) originals largely carry over HBO's legacy
    # broadcast-era 9:00 PM Eastern premiere slot for a same-night
    # streaming simulcast.
    "Max": ("21:00", "America/New_York"),
    "HBO Max": ("21:00", "America/New_York"),
    # Paramount+ originals conventionally release at 3:00 AM Eastern,
    # mirroring Disney+'s early-morning-ET drop pattern.
    "Paramount+": ("03:00", "America/New_York"),
    # Peacock originals conventionally release at 3:00 AM Eastern as well.
    "Peacock": ("03:00", "America/New_York"),
    # Crunchyroll simulcasts each have their own weekly time, but the large
    # majority are timed to noon Pacific — the slot Crunchyroll itself has
    # publicly cited for new-episode availability.
    "Crunchyroll": ("12:00", "America/Los_Angeles"),
}


def estimate_platform_air_time(network_names: list[str]) -> Optional[tuple[str, str]]:
    """
    The first PLATFORM_AIR_TIME_CONVENTIONS match against `network_names`
    (CachedShow.networks — TMDB's `networks[].name` list for the show), or
    None if nothing in it is a platform this module has a convention for.

    Exact, case-sensitive matching only: TMDB's own network naming is
    consistent release to release, so fuzzy-matching (e.g. "Prime" against
    "Prime Video") would only add a real risk of a false positive for no
    practical gain.
    """
    for name in network_names:
        match = PLATFORM_AIR_TIME_CONVENTIONS.get(name)
        if match is not None:
            return match
    return None
