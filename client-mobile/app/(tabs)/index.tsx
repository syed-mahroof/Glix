// client-mobile/app/(tabs)/index.tsx
// Glix V2 — Shows Hub
// Dual-tab layout (mirrors TV Time): a top-level segmented control switches
// between WATCH LIST (dense FlashList of tracked episodes with pill filters
// and the circular checkmarks) and UPCOMING (a nested List/Calendar toggle
// showing everything airing next).

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarDays, ChevronDown, ChevronUp, LayoutGrid, List as ListIcon, ListChecks, RefreshCw, Tv } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CalendarGrid from '../../components/CalendarGrid';
import CascadeModal from '../../components/CascadeModal';
import FilterPill from '../../components/FilterPill';
import GlassSurface from '../../components/GlassSurface';
import HistoryRow from '../../components/HistoryRow';
import HubHeadingSwitch, { HubKind } from '../../components/HubHeadingSwitch';
import LayoutToggle from '../../components/LayoutToggle';
import PressableScale from '../../components/PressableScale';
import { SegmentedControl } from '../../components/SegmentedControl';
import ShowPosterCard from '../../components/ShowPosterCard';
import ShowRow from '../../components/ShowRow';
import Snackbar from '../../components/Snackbar';
import { isAnimeByGenresAndLanguage } from '../../lib/anime';
import {
  formatCountdown,
  formatDaysAgo,
  hasAired,
  pad,
  resolveAirInstant,
  resolveDisplayDateIso,
  todayLocalIso,
} from '../../lib/dateFormat';
import { useAppTheme } from '../../lib/theme';
import {
  buildUpcomingItems,
  groupUpcomingItemsByDate,
  pickNextEpisode,
  UpcomingItem,
  UpcomingListEntry,
} from '../../lib/upcoming';
import { useCatchupCascade } from '../../lib/useCatchupCascade';
import { Episode, useLayoutFor, useWatchStore, WatchlistBuckets, WatchlistEntry } from '../../store/watchStore';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

// ─── Top-level / nested tabs ────────────────────────────────────────────────────

type HubTab = 'watchlist' | 'upcoming';
type UpcomingView = 'list' | 'calendar';

// ─── Filter categories (Watch List tab) ────────────────────────────────────────

type FilterKey = 'WATCH_NEXT' | 'ATTENTION' | 'NOT_STARTED' | 'HISTORY';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'WATCH_NEXT', label: 'WATCH NEXT' },
  { key: 'ATTENTION', label: "HAVEN'T WATCHED FOR A WHILE" },
  { key: 'NOT_STARTED', label: "HAVEN'T STARTED" },
  { key: 'HISTORY', label: 'WATCH HISTORY' },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface ShowEpisodeRow {
  id: string; // unique key: `${showId}-${episodeId}`, or `zombie-${showId}`
  showId: number;
  showTitle: string;
  posterPath: string | null;
  /** Null when this entry has no cached episode data at all (e.g. two
   *  consecutive TMDB eager-cache failures right after adding a show) —
   *  the row renders a fallback "tap to retry" state instead of episode
   *  details. See ZombieRow. */
  episode: Episode | null;
  /** Whether the row's next episode has already aired. When false the
   *  checkmark is disabled — a future episode can't be marked watched. */
  isAired: boolean;
  /** For recency-aware pill sorting. ISO string or null. */
  lastWatchedAt: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Picks the "next" episode from a watchlist entry — the lowest-numbered
 * unwatched episode that has already aired. Falls back to the first episode
 * overall if none qualifies (to show shows with 0 episodes aired yet).
 */
/*
 * Pill criteria (mirrors TV Time's "continue watching" model, made truthful
 * to each label). Categories are exclusive; HISTORY is a non-exclusive log
 * overlay of everything with any watch activity:
 *
 *   HAVEN'T STARTED   watched === 0                  — added, no episode watched
 *   UP TO DATE        aired>0 && watched >= aired    — caught up on all aired
 *   HAVEN'T WATCHED   0 < watched < aired            — started but behind. Sorted
 *   FOR A WHILE                                        stalest-first (oldest
 *                                                       last_watched_at at top),
 *                                                       so the label is literal.
 *   WATCH HISTORY     watched > 0                    — any activity, most-recent
 *                                                       first (a proper log).
 *
 * Recency comes from the backend's last_watched_at annotation, not a hard
 * stale-threshold filter: hiding actively-behind shows from every primary
 * pill would be worse UX than surfacing them, stalest-first.
 */
function buildRows(entries: WatchlistEntry[], filter: FilterKey): ShowEpisodeRow[] {
  // HISTORY is now handled separately by the backend / watch-history/ endpoint.
  // We return empty here so the FlashList for HISTORY is fed from the new data source instead.
  if (filter === 'HISTORY') return [];

  const todayMs = Date.now();
  const INACTIVITY_MS = 14 * 24 * 60 * 60 * 1000;
  const rows: ShowEpisodeRow[] = [];

  for (const entry of entries) {
    const { aired_episode_count, watched_episode_count, status } = entry;

    if (status === 'ARCHIVED') continue; // never show archived in the main list

    // Computed once per entry — used both to categorize and to build the
    // row below, instead of the two separate calls this used to make.
    const episode = pickNextEpisode(entry);

    // Categorize
    let category: FilterKey;
    if (watched_episode_count === 0) {
      category = 'NOT_STARTED';
    } else if (aired_episode_count > 0 && watched_episode_count >= aired_episode_count) {
      continue; // Up to date shows are omitted from the main "to watch" queue
    } else {
      let isFreshDrop = false;
      if (episode?.air_date) {
        const airMs = new Date(`${episode.air_date}T00:00:00`).getTime();
        if (todayMs - airMs <= INACTIVITY_MS) {
          isFreshDrop = true;
        }
      }

      if (isFreshDrop) {
        category = 'WATCH_NEXT';
      } else if (entry.last_watched_at) {
        const lastWatchedMs = new Date(entry.last_watched_at).getTime();
        if (todayMs - lastWatchedMs > INACTIVITY_MS) {
          category = 'ATTENTION';
        } else {
          category = 'WATCH_NEXT';
        }
      } else {
        category = 'ATTENTION';
      }
    }

    if (category !== filter) continue;

    // `episode` is null when this entry has no cached episode data at all
    // (e.g. two consecutive TMDB eager-cache failures right after adding a
    // show) — this used to silently drop the entry from every bucket
    // ("zombie" watchlist rows the user could never find or retry from the
    // Hub). Push a fallback row instead; ZombieRow/its grid equivalent
    // route into the show detail screen, which re-triggers a real fetch.
    rows.push({
      id: episode ? `${entry.show.tmdb_id}-${episode.tmdb_id}` : `zombie-${entry.show.tmdb_id}`,
      showId: entry.show.tmdb_id,
      showTitle: entry.show.title,
      posterPath: entry.show.poster_path,
      episode,
      isAired: hasAired(episode?.air_date),
      lastWatchedAt: entry.last_watched_at,
    });
  }

  // Recency-aware ordering makes the recency-labelled pills honest.
  const ms = (v: string | null) => (v ? new Date(v).getTime() : 0);
  if (filter === 'ATTENTION') {
    rows.sort((a, b) => ms(a.lastWatchedAt) - ms(b.lastWatchedAt)); // stalest first
  } else if (filter === 'WATCH_NEXT') {
    rows.sort((a, b) => ms(b.lastWatchedAt) - ms(a.lastWatchedAt)); // most recent first
  }

  return rows;
}

function getAllEntries(watchlist: WatchlistBuckets): WatchlistEntry[] {
  return [
    ...watchlist.to_watch.results,
    ...watchlist.up_to_date.results,
    ...watchlist.archived.results,
  ];
}

/** Ticking "now" for the UPCOMING tab's live countdowns. `active` gates the
 *  interval: the WATCH LIST tab is a heavy FlashList (posters + progress
 *  rings) and doesn't show any per-second countdown, so ticking there
 *  re-rendered the whole Shows Hub once a second for nothing. Only tick while
 *  the countdowns are actually on screen. Refreshes immediately on
 *  (re)activation so a value frozen from the last active period isn't shown
 *  for up to a second after switching back. */
function useNow(intervalMs: number, active: boolean = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, active]);
  return now;
}

/** Grid card overlay badge for a Watch List row: episode label when aired,
 *  or a countdown when the next episode hasn't aired yet (highlighted for
 *  same-day/next-day urgency) — the "premiere tag/countdown" badge the
 *  poster-grid design calls for. */
function gridBadgeForRow(item: ShowEpisodeRow): { label: string; highlighted: boolean } {
  if (!item.episode) return { label: 'NO DATA', highlighted: false };
  if (item.isAired) {
    return {
      label: `S${pad(item.episode.season_number)} · E${pad(item.episode.episode_number)}`,
      highlighted: false,
    };
  }
  if (!item.episode.air_date) return { label: 'UPCOMING', highlighted: false };
  const todayMs = new Date().setHours(0, 0, 0, 0);
  const airMs = new Date(`${item.episode.air_date}T00:00:00`).getTime();
  const diffDays = Math.round((airMs - todayMs) / 86400000);
  if (diffDays <= 0) return { label: 'TODAY', highlighted: true };
  if (diffDays === 1) return { label: 'TOMORROW', highlighted: true };
  return { label: `+${diffDays} DAYS`, highlighted: false };
}

// ─── Zombie Row (List view fallback for zero-cached-episode entries) ──────────
// A watchlist entry can have no cached episode data at all — see the
// buildRows() comment on the null-episode row it produces. Shares ShowRow's
// footprint (poster + text column, same 100px height) for visual consistency
// in the list, but has no checkmark since there's nothing to mark watched —
// tapping through re-triggers a real TMDB fetch.
function ZombieRow({
  showId,
  showTitle,
  posterPath,
}: {
  showId: number;
  showTitle: string;
  posterPath: string | null;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[styles.zombieRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
      onPress={() => router.push(`/show/${showId}`)}
      accessibilityRole="button"
      accessibilityLabel={`${showTitle} — episode data unavailable, tap to retry`}
    >
      <Image
        source={posterPath ? { uri: `${POSTER_BASE_URL}${posterPath}` } : undefined}
        style={[styles.zombiePoster, { backgroundColor: c.bgElevated }]}
        contentFit="cover"
        transition={150}
        recyclingKey={String(showId)}
        cachePolicy="memory-disk"
      />
      <View style={styles.zombieTextCol}>
        <Text style={[styles.zombieShowTitle, { color: c.textPrimary }]} numberOfLines={1}>
          {showTitle}
        </Text>
        <Text style={[styles.zombieSubtitle, { color: c.textTertiary }]}>
          Episode data unavailable — tap to retry
        </Text>
      </View>
      <RefreshCw color={c.textTertiary} size={18} />
    </PressableScale>
  );
}

// ─── Upcoming Row (Upcoming > List tab) ────────────────────────────────────────

function UpcomingRow({
  item,
  now,
  onMarkWatched,
}: {
  item: UpcomingItem;
  now: Date;
  /** Omitted (no checkmark rendered) when the episode hasn't aired yet — a
   *  future episode can't be marked watched (WatchStateToggleView rejects
   *  it server-side), so there's no point showing a tappable control that
   *  would just error. Present for TODAY items and for the aired-but-
   *  overdue items buildUpcomingItems() now keeps in this list (Phase G). */
  onMarkWatched?: (item: UpcomingItem) => void;
}) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const target = resolveAirInstant(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone);
  const { formatted, isImminent, dayOfWeek } = formatCountdown(target, now);
  const displayDateIso = resolveDisplayDateIso(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone);
  const isAired = hasAired(item.airDate, now);
  // Distinct from isAired: a TODAY item is technically "aired" (markable —
  // WatchStateToggleView's own gate is air_date <= today) but still shows
  // its normal countdown text; only a genuinely past date (Phase G's
  // overdue items) swaps to the "OVERDUE" label — formatCountdown clamps a
  // negative diff to 00:00:00, which would misleadingly read as "airing
  // right now" instead of "N days ago" for those.
  const isOverdue = displayDateIso < todayLocalIso(now);
  const canMarkWatched = isAired && item.episodeId != null && !!onMarkWatched;

  return (
    <PressableScale
      style={[styles.upcomingRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
      onPress={() =>
        router.push({
          pathname: `/show/${item.tmdbShowId}` as any,
          params: { title: item.showTitle, poster_path: item.posterPath ?? '' },
        })
      }
      accessibilityRole="button"
      accessibilityLabel={`${item.showTitle} — S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}`}
    >
      <Image
        source={item.posterPath ? { uri: `${POSTER_BASE_URL}${item.posterPath}` } : undefined}
        style={[styles.upcomingPoster, { backgroundColor: c.bgElevated }]}
        contentFit="cover"
        transition={150}
        recyclingKey={String(item.tmdbShowId)}
        cachePolicy="memory-disk"
      />
      <View style={styles.upcomingTextCol}>
        <Text style={[styles.upcomingShowTitle, { color: c.textPrimary }]} numberOfLines={1}>
          {item.showTitle}
        </Text>
        <Text style={[styles.upcomingEpLabel, { color: c.textSecondary }]} numberOfLines={1}>
          S{pad(item.seasonNumber)}E{pad(item.episodeNumber)} · {item.episodeTitle}
        </Text>
        <Text
          style={[
            styles.upcomingCountdown,
            { color: c.textSecondary },
            isImminent && { color: c.accentInk },
            isOverdue && { color: c.negative },
          ]}
        >
          {isOverdue ? formatDaysAgo(displayDateIso, now) : `${formatted} (${dayOfWeek})`}
        </Text>
      </View>
      {canMarkWatched && (
        <PressableScale
          onPress={(event) => {
            event.stopPropagation();
            onMarkWatched!(item);
          }}
          hitSlop={10}
          style={[styles.upcomingCheckBtn, { borderColor: c.hairline }]}
          accessibilityRole="button"
          accessibilityLabel="Mark as watched"
        >
          <View style={[styles.upcomingCheckCircle, { borderColor: c.accentFill }]} />
        </PressableScale>
      )}
    </PressableScale>
  );
}

// ─── Upcoming Section Header (day-wise grouping) ───────────────────────────────

/** Past-dated headers (LAST WEEK / LAST MONTH — recently-aired episodes the
 *  user hasn't marked) are collapsible and default closed, so a catch-up
 *  section can never swallow the screen ahead of the genuinely future
 *  TODAY/TOMORROW/weekday sections. Every future header is a plain,
 *  non-interactive date label, unchanged from Phase 18. */
function UpcomingSectionHeader({
  label,
  count,
  collapsible,
  collapsed,
  onToggleCollapse,
}: {
  label: string;
  count: number;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const isCollapsible = !!collapsible && onToggleCollapse != null;

  const pill = (
    <View style={styles.upcomingSectionHeaderRow}>
      <View
        style={[
          styles.upcomingSectionPill,
          { backgroundColor: c.glassFill, borderColor: c.hairline },
          isCollapsible && { borderColor: c.negative },
        ]}
      >
        <Text
          style={[
            styles.upcomingSectionPillText,
            { color: isCollapsible ? c.negative : c.textSecondary },
          ]}
        >
          {isCollapsible ? `${label} (${count})` : label}
        </Text>
        {isCollapsible &&
          (collapsed ? (
            <ChevronDown size={14} color={c.negative} style={styles.upcomingSectionChevron} />
          ) : (
            <ChevronUp size={14} color={c.negative} style={styles.upcomingSectionChevron} />
          ))}
      </View>
    </View>
  );

  if (!isCollapsible) return pill;

  return (
    <PressableScale
      onPress={onToggleCollapse}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${count} missed episodes`}
      accessibilityState={{ expanded: !collapsed }}
    >
      {pill}
    </PressableScale>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ShowsScreen() {
  // Scoped selectors (not a bare useWatchStore()) — this is the default tab,
  // mounted for the app's whole lifetime, so a bare call re-rendered this
  // entire heavy screen (FlashList + posters + progress rings) on every
  // store mutation anywhere, including ones this screen doesn't render
  // anything from. See app/_layout.tsx for the full note.
  const watchlist = useWatchStore((s) => s.watchlist);
  const history = useWatchStore((s) => s.history);
  const isLoadingWatchlist = useWatchStore((s) => s.isLoadingWatchlist);
  const isLoadingHistory = useWatchStore((s) => s.isLoadingHistory);
  const error = useWatchStore((s) => s.error);
  const fetchWatchlist = useWatchStore((s) => s.fetchWatchlist);
  const fetchHistory = useWatchStore((s) => s.fetchHistory);
  const clearError = useWatchStore((s) => s.clearError);
  const toggleWatchState = useWatchStore((s) => s.toggleWatchState);
  const bulkToggleWatchState = useWatchStore((s) => s.bulkToggleWatchState);
  const layout = useLayoutFor('shows');
  const setLayoutForScope = useWatchStore((s) => s.setLayoutForScope);
  const { highlightFilter } = useLocalSearchParams<{ highlightFilter?: string }>();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const router = useRouter();

  // Shows vs. Anime heading (Phase 75.2) — filters the WATCH LIST tab only.
  // UPCOMING is deliberately left unfiltered by hubKind: it's meant to read
  // as "everything airing next" regardless of which heading is selected, a
  // decision made explicitly rather than an oversight.
  const [hubKind, setHubKind] = useState<HubKind>('shows');
  const [activeTab, setActiveTab] = useState<HubTab>('watchlist');
  const [upcomingView, setUpcomingView] = useState<UpcomingView>('list');
  const [filter, setFilter] = useState<FilterKey>('WATCH_NEXT');
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Past sections (LAST WEEK / LAST MONTH) default closed — a bounded
  // catch-up list the user opts into, not a wall of backlog ahead of real
  // future dates. Only labels the user has explicitly opened live in here.
  const [expandedPastLabels, setExpandedPastLabels] = useState<string[]>([]);

  const upcomingItems = useMemo(
    () => buildUpcomingItems([...watchlist.to_watch.results, ...watchlist.up_to_date.results]),
    [watchlist]
  );

  // Phase 75.8: ticked at a flat 1s whenever the Upcoming List view was
  // active, regardless of whether anything was actually about to air —
  // re-rendering the whole list every second even when the soonest item
  // was weeks out. Only ticks that fast when something is genuinely
  // imminent (<1h away); otherwise a 60s tick is plenty for a countdown
  // measured in days. Deliberately NOT memoized on `upcomingItems` alone —
  // this component already re-renders once per tick (useNow's own state
  // update below) while active, so a plain recompute against Date.now() at
  // each of those renders is what lets crossing the 1h boundary self-correct
  // without waiting on the next watchlist refetch.
  //
  // Perf fix (2026-08-07): this used to run unconditionally on every render
  // of ShowsScreen, including every render of the WATCH LIST tab and the
  // Upcoming GRID view, where its result (tickIntervalMs) is never read —
  // useNow(_, active=false) below ignores it entirely. Each iteration calls
  // resolveAirInstant(), which was the single most expensive routine
  // operation in the app before dateFormat.ts's Intl.DateTimeFormat caching,
  // and even post-cache still allocates Dates per item. Skipping the whole
  // pass whenever nothing on screen actually consumes it is strictly free.
  const isUpcomingListTicking = activeTab === 'upcoming' && upcomingView === 'list';
  let soonestFutureMs = Infinity;
  if (isUpcomingListTicking) {
    for (const item of upcomingItems) {
      const delta = resolveAirInstant(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone).getTime() - Date.now();
      if (delta > 0 && delta < soonestFutureMs) soonestFutureMs = delta;
    }
  }
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const tickIntervalMs = soonestFutureMs < ONE_HOUR_MS ? 1000 : 60000;
  const now = useNow(tickIntervalMs, isUpcomingListTicking);

  // Arriving from "Add to Watchlist" (show detail) passes highlightFilter
  // so the newly added show's bucket is on-screen immediately instead of
  // requiring the user to hunt through pills. Also forces the WATCH LIST
  // top-level tab, in case this screen stayed mounted on UPCOMING.
  useEffect(() => {
    if (highlightFilter && FILTERS.some((f) => f.key === highlightFilter)) {
      setFilter(highlightFilter as FilterKey);
      setActiveTab('watchlist');
    }
  }, [highlightFilter]);

  // Catch-Up cascade modal — shared decision-tree hook (also used by the
  // season screen and episode detail screen). Un-watching bypasses this
  // entirely (handled directly in handleCheckPress's else branch below);
  // this only fires when marking an episode watched.
  // Passed directly (not wrapped in an inline arrow) — useCatchupCascade
  // latches this into a ref internally, but a stable reference here still
  // means the returned `catchup` object's identity only ever changes when
  // the modal's own state does, not on every ShowsScreen render.
  const catchup = useCatchupCascade(bulkToggleWatchState);

  useEffect(() => {
    fetchWatchlist();
    fetchHistory();
  }, [fetchWatchlist, fetchHistory]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([fetchWatchlist(), fetchHistory()]);
    setIsRefreshing(false);
  }, [fetchWatchlist, fetchHistory]);

  const allEntries = useMemo(() => getAllEntries(watchlist), [watchlist]);
  // WATCH LIST rows are split by the Shows/Anime heading; UPCOMING (below)
  // is built from the unfiltered watchlist on purpose — see hubKind's note.
  const hubFilteredEntries = useMemo(
    () =>
      allEntries.filter((entry) => {
        const isAnime = isAnimeByGenresAndLanguage(entry.show.genres, entry.show.original_language);
        return hubKind === 'anime' ? isAnime : !isAnime;
      }),
    [allEntries, hubKind]
  );
  const rows = useMemo(() => buildRows(hubFilteredEntries, filter), [hubFilteredEntries, filter]);

  // Day-wise grouping (user-requested): TODAY/TOMORROW/weekday/exact-date
  // headers, so an episode of one show and an episode of another show
  // releasing on the same day land under one shared header instead of an
  // undifferentiated flat list. See lib/upcoming.ts's groupUpcomingItemsByDate.
  const upcomingEntries = useMemo(
    () => groupUpcomingItemsByDate(upcomingItems, now),
    [upcomingItems, now]
  );

  // A collapsible header itself always renders (it's the toggle affordance);
  // only the item rows beneath it hide while collapsed. Items of one bucket
  // are contiguous right after their header (buildUpcomingItems sorts by
  // airDate), so a single pass tracking "am I inside a hidden section" works.
  const visibleUpcomingEntries = useMemo(() => {
    const result: UpcomingListEntry[] = [];
    let hidingItems = false;
    for (const entry of upcomingEntries) {
      if (entry.type === 'header') {
        hidingItems = entry.collapsible && !expandedPastLabels.includes(entry.label);
        result.push(entry);
        continue;
      }
      if (!hidingItems) result.push(entry);
    }
    return result;
  }, [upcomingEntries, expandedPastLabels]);

  const togglePastSection = useCallback(
    (label: string) =>
      setExpandedPastLabels((prev) =>
        prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
      ),
    []
  );

  const handleCheckPress = useCallback(
    (
      episodeId: number,
      showId: number,
      showTitle: string,
      seasonNumber: number,
      episodeNumber: number
    ) => {
      const allEntries = getAllEntries(watchlist);
      const entry = allEntries.find((e) => e.show.episodes.some((ep) => ep.tmdb_id === episodeId));
      const episode = entry?.show.episodes.find((ep) => ep.tmdb_id === episodeId);

      if (episode?.is_watched) {
        // Un-watching: no catch-up concern either way, update immediately
        // (no exit animation). Checking the catch-up backend here too
        // would risk popping "mark previous episodes watched?" on an
        // UN-watch tap whenever an earlier episode happens to be
        // unwatched — wrong prompt for the action being taken.
        toggleWatchState(episodeId);
        return;
      }

      // Watching: check for chronologically-prior unwatched episodes. This
      // is now an async backend round-trip (CatchupCheckView) — fired here
      // without awaiting since ShowRow's own tap animation already plays
      // optimistically and independently, then calls onAnimationComplete
      // (handleRowAnimationComplete, below) ~420ms later, which flushes the
      // actual toggle. That toggle is safe to fire either way: if this
      // check ends up showing the modal, the modal's own finalize call
      // marks this episode watched too (idempotent — already-watched
      // episodes are skipped by the bulk endpoint), so there's no
      // double-toggle risk regardless of which resolves first.
      const label = `S${pad(seasonNumber)}E${pad(episodeNumber)}`;
      catchup.checkEpisode(showId, episodeId, showTitle, label);
    },
    [catchup, toggleWatchState, watchlist]
  );

  /** Grid card checkmark — called by ShowPosterCard after its own ~420ms
   *  confirm animation, same as ShowRow's onAnimationComplete for the list.
   *
   *  Bug fix (2026-08-07, grid mark-watched lag): this used to `await
   *  catchup.checkEpisode(...)` before committing — a real POST to a
   *  Render free-tier dyno (up to a ~20-50s cold-start RTT) sitting
   *  directly between the tap and the store update, during which the
   *  card's checkmark sat frozen and swallowed further taps. Firing the
   *  check WITHOUT awaiting and committing immediately is exactly the
   *  contract handleCheckPress (list mode, below) already relies on: every
   *  Catch-Up modal outcome (confirm/cancel/neverForShow) finalizes this
   *  same episode watched regardless of what already happened to it, and
   *  bulkToggleWatchState now skips ids whose server state already matches
   *  before hitting the wire (see watchStore.ts), so there's no
   *  double-toggle risk no matter which resolves first. */
  const handleGridCheckPress = useCallback(
    (
      episodeId: number,
      showId: number,
      showTitle: string,
      seasonNumber: number,
      episodeNumber: number,
      isWatched: boolean
    ) => {
      if (isWatched) {
        toggleWatchState(episodeId);
        return;
      }
      const label = `S${pad(seasonNumber)}E${pad(episodeNumber)}`;
      catchup.checkEpisode(showId, episodeId, showTitle, label);
      toggleWatchState(episodeId);
    },
    [catchup, toggleWatchState]
  );

  /** Upcoming tab's inline mark-watched (Phase G) — reuses handleGridCheckPress
   *  rather than a third implementation: an Upcoming item is only ever shown
   *  while unwatched (buildUpcomingItems filters to unwatched episodes), so
   *  this is always the "mark watched" direction, same catch-up-aware flow,
   *  no exit-collapse animation to coordinate (UpcomingRow/the grid card
   *  have none, unlike ShowRow). Works for both the List and Grid views. */
  const handleUpcomingMarkWatched = useCallback(
    (item: UpcomingItem) => {
      if (item.episodeId == null) return;
      handleGridCheckPress(item.episodeId, item.tmdbShowId, item.showTitle, item.seasonNumber, item.episodeNumber, false);
    },
    [handleGridCheckPress]
  );

  /** Fired by ShowRow AFTER its collapse animation finishes.
   *  This is the moment we flush the Zustand optimistic update so that
   *  the row is truly gone before the list re-renders with the next episode. */
  const handleRowAnimationComplete = useCallback(
    (episodeId: number) => {
      toggleWatchState(episodeId);
    },
    [toggleWatchState]
  );

  const renderRow = useCallback(
    ({ item }: { item: ShowEpisodeRow }): React.ReactElement => {
      if (!item.episode) {
        return <ZombieRow showId={item.showId} showTitle={item.showTitle} posterPath={item.posterPath} />;
      }
      const episode = item.episode;
      return (
        <ShowRow
          showId={item.showId}
          showTitle={item.showTitle}
          posterPath={item.posterPath}
          seasonNumber={episode.season_number}
          episodeNumber={episode.episode_number}
          episodeTitle={episode.title}
          episodeId={episode.tmdb_id}
          airDate={episode.air_date}
          isWatched={episode.is_watched}
          isAired={item.isAired}
          onCheckPress={(epId) =>
            handleCheckPress(epId, item.showId, item.showTitle, episode.season_number, episode.episode_number)
          }
          onAnimationComplete={handleRowAnimationComplete}
        />
      );
    },
    [handleCheckPress, handleRowAnimationComplete]
  );

  const renderGridRow = useCallback(
    ({ item }: { item: ShowEpisodeRow }): React.ReactElement => {
      const badge = gridBadgeForRow(item);
      if (!item.episode) {
        return (
          <ShowPosterCard
            showId={item.showId}
            title={item.showTitle}
            posterPath={item.posterPath}
            overlayBadge={badge.label}
            subtitle="Tap to retry"
          />
        );
      }
      const episode = item.episode;
      return (
        <ShowPosterCard
          showId={item.showId}
          title={item.showTitle}
          posterPath={item.posterPath}
          overlayBadge={badge.label}
          overlayBadgeHighlighted={badge.highlighted}
          subtitle={episode.title}
          checkmark={{
            isWatched: episode.is_watched,
            disabled: !item.isAired && !episode.is_watched,
            itemId: episode.tmdb_id,
            onPress: () =>
              handleGridCheckPress(
                episode.tmdb_id,
                item.showId,
                item.showTitle,
                episode.season_number,
                episode.episode_number,
                episode.is_watched
              ),
          }}
        />
      );
    },
    [handleGridCheckPress]
  );

  const renderUpcomingEntry = useCallback(
    ({ item: entry }: { item: UpcomingListEntry }): React.ReactElement =>
      entry.type === 'header' ? (
        <UpcomingSectionHeader
          label={entry.label}
          count={entry.count}
          collapsible={entry.collapsible}
          collapsed={!expandedPastLabels.includes(entry.label)}
          onToggleCollapse={entry.collapsible ? () => togglePastSection(entry.label) : undefined}
        />
      ) : (
        <UpcomingRow item={entry.data} now={now} onMarkWatched={handleUpcomingMarkWatched} />
      ),
    [now, handleUpcomingMarkWatched, expandedPastLabels, togglePastSection]
  );

  const renderUpcomingGridEntry = useCallback(
    ({ item: entry }: { item: UpcomingListEntry }): React.ReactElement => {
      if (entry.type === 'header')
        return (
          <UpcomingSectionHeader
            label={entry.label}
            count={entry.count}
            collapsible={entry.collapsible}
            collapsed={!expandedPastLabels.includes(entry.label)}
            onToggleCollapse={entry.collapsible ? () => togglePastSection(entry.label) : undefined}
          />
        );
      const item = entry.data;
      const displayDateIso = resolveDisplayDateIso(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone);
      const isOverdue = displayDateIso < todayLocalIso(now);
      const isAired = hasAired(item.airDate, now);
      const target = resolveAirInstant(item.airDate, item.airDateTime, item.airsTime, item.airsTimezone);
      const { formatted, isImminent, dayOfWeek } = formatCountdown(target, now);
      return (
        <ShowPosterCard
          showId={item.tmdbShowId}
          title={item.showTitle}
          posterPath={item.posterPath}
          overlayBadge={isOverdue ? formatDaysAgo(displayDateIso, now) : `${formatted} (${dayOfWeek})`}
          overlayBadgeHighlighted={isImminent}
          subtitle={`S${pad(item.seasonNumber)}E${pad(item.episodeNumber)} · ${item.episodeTitle}`}
          checkmark={
            isAired && item.episodeId != null
              ? { isWatched: false, itemId: item.episodeId, onPress: () => handleUpcomingMarkWatched(item) }
              : undefined
          }
        />
      );
    },
    [now, handleUpcomingMarkWatched, expandedPastLabels, togglePastSection]
  );

  const upcomingItemType = useCallback(
    (entry: UpcomingListEntry) => entry.type,
    []
  );

  const upcomingOverrideLayout = useCallback(
    (layout: { span?: number }, entry: UpcomingListEntry, _index: number, maxColumns: number) => {
      // Section headers always span the full row width, even in the
      // 2-column grid view — otherwise a header would sit awkwardly next
      // to a poster card instead of separating the day's items cleanly.
      if (entry.type === 'header') layout.span = maxColumns;
    },
    []
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <HubHeadingSwitch value={hubKind} onChange={setHubKind} />
        <View style={styles.headerRight}>
          <PressableScale
            style={[styles.headerIcon, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
            onPress={() => router.push('/lists?media=tv' as any)}
            accessibilityRole="button"
            accessibilityLabel="My Lists"
          >
            <ListChecks color={c.accentInk} size={22} strokeWidth={2} />
          </PressableScale>
        </View>
      </View>

      {/* ── Error Banner ── */}
      {error && (
        <PressableScale
          style={[
            styles.errorBanner,
            { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' },
          ]}
          onPress={clearError}
        >
          <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
        </PressableScale>
      )}

      {/* ── Top-level Tabs: Watch List / Upcoming ── */}
      <View style={styles.topTabsWrapper}>
        <SegmentedControl
          segments={[
            { value: 'watchlist', label: 'WATCH LIST' },
            { value: 'upcoming', label: 'UPCOMING' },
          ]}
          selectedValue={activeTab}
          onValueChange={setActiveTab}
        />
      </View>

      {activeTab === 'watchlist' ? (
        <>
          {/* ── Filter Pills ── */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsContainer}
            style={styles.pillsScroll}
          >
            {FILTERS.map((f) => (
              <FilterPill
                key={f.key}
                label={f.label}
                active={filter === f.key}
                onPress={() => setFilter(f.key)}
              />
            ))}
          </ScrollView>

          {/* ── Layout toggle: right-aligned below the pills ── */}
          <View style={styles.layoutToggleRow}>
            <LayoutToggle scope="shows" />
          </View>

          {/* ── List ── */}
          {filter === 'HISTORY' ? (
             isLoadingHistory && history.results.length === 0 ? (
               <View style={styles.centered}>
                 <ActivityIndicator color={c.accentInk} size="large" />
               </View>
             ) : history.results.length === 0 ? (
               <View style={styles.centered}>
                 <GlassSurface radius={20} style={styles.emptyCard}>
                   <Tv color={c.textTertiary} size={48} strokeWidth={1.5} />
                   <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>Nothing here</Text>
                   <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>No watch history found.</Text>
                 </GlassSurface>
               </View>
             ) : (
               <FlashList
                 data={history.results}
                 keyExtractor={(item) => item.id}
                 renderItem={({ item }) => <HistoryRow item={item} />}
                 contentContainerStyle={styles.listContent}
                 refreshControl={
                   <RefreshControl
                     refreshing={isRefreshing}
                     onRefresh={handleRefresh}
                     tintColor={c.accentInk}
                   />
                 }
                 showsVerticalScrollIndicator={false}
               />
             )
          ) : isLoadingWatchlist && rows.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator color={c.accentInk} size="large" />
            </View>
          ) : rows.length === 0 ? (
            <View style={styles.centered}>
              <GlassSurface radius={20} style={styles.emptyCard}>
                <Tv color={c.textTertiary} size={48} strokeWidth={1.5} />
                <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>Nothing here</Text>
                <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
                  {filter === 'ATTENTION'
                    ? "You're all caught up — nothing needs attention."
                    : filter === 'NOT_STARTED'
                    ? `Every ${hubKind === 'anime' ? 'anime' : 'show'} in your list has been started.`
                    : `No ${hubKind === 'anime' ? 'anime' : 'shows'} to watch next.`}
                </Text>
              </GlassSurface>
            </View>
          ) : (
            <FlashList
              // Perf fix (2026-08-07): this used to key on `layout`, forcing
              // FlashList to fully unmount+remount (destroying every visible
              // ShowRow/ShowPosterCard, re-decoding every poster image) on
              // every list<->grid toggle. FlashList v2 already handles a
              // numColumns change on the existing layout manager instance
              // (verified against RecyclerViewManager.js's updateLayoutParams
              // — only `horizontal` toggling is unsupported without a
              // remount) and renderItem/extraData changing identity already
              // tells it which cells need to re-render. No key needed.
              data={rows}
              keyExtractor={(item) => item.id}
              renderItem={layout === 'grid' ? renderGridRow : renderRow}
              numColumns={layout === 'grid' ? 3 : 1}
              extraData={layout}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor={c.accentInk}
                />
              }
              showsVerticalScrollIndicator={false}
            />
          )}
        </>
      ) : (
        <View style={styles.upcomingContainer}>
          {/* ── View toggle: List / Grid / Calendar ──
              Deliberately NOT another full-width SegmentedControl — stacked
              directly under the WATCH LIST/UPCOMING bar, a second identical
              full-width pill read as "4 stacked bars." This is a compact,
              icon-only, right-aligned utility control instead — visually a
              tier below the primary tab switch, not a peer to it.
              3-way, not a separate global-toggle-plus-2-way-control: List
              and Grid both drive the same 'shows'-scoped layout the pills
              row's toggle drives on WATCH LIST, so a duplicate toggle
              stacked on top of this one would just be a second control for
              the same state. Calendar is its own view, orthogonal to
              list/grid. */}
          <View
            style={[
              styles.viewToggleRow,
              { backgroundColor: c.glassFill, borderColor: c.hairline },
            ]}
          >
            <PressableScale
              onPress={() => {
                setUpcomingView('list');
                if (layout !== 'list') setLayoutForScope('shows', 'list');
              }}
              style={[
                styles.viewToggleBtn,
                upcomingView === 'list' &&
                  layout === 'list' && { backgroundColor: c.accentFill },
              ]}
              accessibilityRole="button"
              accessibilityLabel="List view"
              accessibilityState={{ selected: upcomingView === 'list' && layout === 'list' }}
            >
              <ListIcon
                color={
                  upcomingView === 'list' && layout === 'list' ? c.onAccent : c.textSecondary
                }
                size={16}
                strokeWidth={2.25}
              />
            </PressableScale>
            <PressableScale
              onPress={() => {
                setUpcomingView('list');
                if (layout !== 'grid') setLayoutForScope('shows', 'grid');
              }}
              style={[
                styles.viewToggleBtn,
                upcomingView === 'list' &&
                  layout === 'grid' && { backgroundColor: c.accentFill },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Grid view"
              accessibilityState={{ selected: upcomingView === 'list' && layout === 'grid' }}
            >
              <LayoutGrid
                color={
                  upcomingView === 'list' && layout === 'grid' ? c.onAccent : c.textSecondary
                }
                size={16}
                strokeWidth={2.25}
              />
            </PressableScale>
            <PressableScale
              onPress={() => setUpcomingView('calendar')}
              style={[
                styles.viewToggleBtn,
                upcomingView === 'calendar' && { backgroundColor: c.accentFill },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Calendar view"
              accessibilityState={{ selected: upcomingView === 'calendar' }}
            >
              <CalendarDays
                color={upcomingView === 'calendar' ? c.onAccent : c.textSecondary}
                size={16}
                strokeWidth={2.25}
              />
            </PressableScale>
          </View>

          {isLoadingWatchlist && upcomingItems.length === 0 ? (
            <View style={styles.centered}>
              <ActivityIndicator color={c.accentInk} size="large" />
            </View>
          ) : upcomingItems.length === 0 ? (
            <View style={styles.centered}>
              <GlassSurface radius={20} style={styles.emptyCard}>
                <CalendarDays color={c.textTertiary} size={48} strokeWidth={1.5} />
                <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>Nothing here</Text>
                <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
                  No upcoming episodes found.
                </Text>
              </GlassSurface>
            </View>
          ) : upcomingView === 'list' ? (
            <FlashList
              data={visibleUpcomingEntries}
              keyExtractor={(entry) => entry.key}
              renderItem={layout === 'grid' ? renderUpcomingGridEntry : renderUpcomingEntry}
              getItemType={upcomingItemType}
              overrideItemLayout={layout === 'grid' ? upcomingOverrideLayout : undefined}
              numColumns={layout === 'grid' ? 3 : 1}
              extraData={[layout, expandedPastLabels]}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor={c.accentInk}
                />
              }
              showsVerticalScrollIndicator={false}
            />
          ) : (
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.calendarScrollContent}
              refreshControl={
                <RefreshControl
                  refreshing={isRefreshing}
                  onRefresh={handleRefresh}
                  tintColor={c.accentInk}
                />
              }
            >
              <CalendarGrid items={upcomingItems} />
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Cascade Catch-Up Modal ── */}
      <CascadeModal
        visible={catchup.visible}
        showTitle={catchup.showTitle}
        episodeLabel={catchup.episodeLabel}
        previousCount={catchup.previousCount}
        onConfirm={catchup.confirm}
        onCancel={catchup.cancel}
        onNeverForThisShow={catchup.neverForShow}
      />

      <Snackbar
        visible={catchup.undoVisible}
        message={`Marked ${catchup.undoCount} episode${catchup.undoCount !== 1 ? 's' : ''} watched`}
        actionLabel="UNDO"
        onAction={catchup.performUndo}
        onDismiss={catchup.dismissUndo}
        bottomOffset={100}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: { fontSize: 13 },
  topTabsWrapper: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  viewToggleRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 3,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  viewToggleBtn: {
    width: 32,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upcomingContainer: {
    flex: 1,
  },
  layoutToggleRow: {
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  pillsScroll: { flexGrow: 0 },
  pillsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    flexDirection: 'row',
  },
  listContent: {
    paddingHorizontal: 14,
    paddingBottom: 120, // space for floating tab bar
  },
  calendarScrollContent: {
    paddingBottom: 120, // space for floating tab bar
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 28,
    paddingVertical: 36,
    width: '100%',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  upcomingSectionHeaderRow: {
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 10,
  },
  upcomingSectionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  upcomingSectionPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  upcomingSectionChevron: {
    marginLeft: 6,
  },
  upcomingRow: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  upcomingPoster: { width: 54, height: 80, borderRadius: 10 },
  upcomingTextCol: { flex: 1, gap: 4 },
  upcomingShowTitle: { fontSize: 15, fontWeight: '700' },
  upcomingEpLabel: { fontSize: 12 },
  upcomingCountdown: {
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  upcomingCheckBtn: {
    padding: 2,
  },
  upcomingCheckCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
  },
  zombieRow: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  zombiePoster: { width: 54, height: 80, borderRadius: 10, opacity: 0.6 },
  zombieTextCol: { flex: 1, gap: 3 },
  zombieShowTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  zombieSubtitle: { fontSize: 12, fontStyle: 'italic' },
});
