// client-mobile/app/(tabs)/index.tsx
// Glix V2 — Shows Hub
// Dual-tab layout (mirrors TV Time): a top-level segmented control switches
// between WATCH LIST (dense FlashList of tracked episodes with pill filters
// and the circular checkmarks) and UPCOMING (a nested List/Calendar toggle
// showing everything airing next).

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CalendarDays, LayoutGrid, List as ListIcon, RefreshCw, Tv } from 'lucide-react-native';
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
import GlassSurface from '../../components/GlassSurface';
import HistoryRow from '../../components/HistoryRow';
import LayoutToggle from '../../components/LayoutToggle';
import PressableScale from '../../components/PressableScale';
import { SegmentedControl } from '../../components/SegmentedControl';
import ShowPosterCard from '../../components/ShowPosterCard';
import ShowRow from '../../components/ShowRow';
import Snackbar from '../../components/Snackbar';
import { formatCountdown, pad, todayLocalIso } from '../../lib/dateFormat';
import { useAppTheme } from '../../lib/theme';
import {
  buildUpcomingItems,
  groupUpcomingItemsByDate,
  pickNextEpisode,
  UpcomingItem,
  UpcomingListEntry,
} from '../../lib/upcoming';
import { useCatchupCascade } from '../../lib/useCatchupCascade';
import { Episode, useWatchStore, WatchlistBuckets, WatchlistEntry } from '../../store/watchStore';

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

  const todayIso = todayLocalIso();
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
      isAired: !!episode?.air_date && episode.air_date <= todayIso,
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

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
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

// ─── Filter Pill (Watch List tab) ──────────────────────────────────────────────

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  return (
    <PressableScale
      style={[
        styles.pill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { borderColor: c.accentFill, backgroundColor: c.accentFill },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.pillText, { color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

// ─── Zombie Row (List view fallback for zero-cached-episode entries) ──────────
// A watchlist entry can have no cached episode data at all — see the
// buildRows() comment on the null-episode row it produces. Shares ShowRow's
// footprint (poster + text column, same 100px height) so it doesn't disturb
// FlashList's estimatedItemSize, but has no checkmark since there's nothing
// to mark watched — tapping through re-triggers a real TMDB fetch.
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

function UpcomingRow({ item, now }: { item: UpcomingItem; now: Date }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const target = new Date(`${item.airDate}T00:00:00`);
  const { formatted, isImminent, dayOfWeek } = formatCountdown(target, now);

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
          ]}
        >
          {formatted} ({dayOfWeek})
        </Text>
      </View>
    </PressableScale>
  );
}

// ─── Upcoming Section Header (day-wise grouping) ───────────────────────────────

function UpcomingSectionHeader({ label }: { label: string }) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={styles.upcomingSectionHeaderRow}>
      <View style={[styles.upcomingSectionPill, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
        <Text style={[styles.upcomingSectionPillText, { color: c.textSecondary }]}>{label}</Text>
      </View>
    </View>
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
  const preferredLayout = useWatchStore((s) => s.preferredLayout);
  const toggleLayout = useWatchStore((s) => s.toggleLayout);
  const { highlightFilter } = useLocalSearchParams<{ highlightFilter?: string }>();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const [activeTab, setActiveTab] = useState<HubTab>('watchlist');
  const [upcomingView, setUpcomingView] = useState<UpcomingView>('list');
  const [filter, setFilter] = useState<FilterKey>('WATCH_NEXT');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const now = useNow(1000);

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
  const catchup = useCatchupCascade((ids, watched) => bulkToggleWatchState(ids, watched));

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
  const rows = useMemo(() => buildRows(allEntries, filter), [allEntries, filter]);

  const upcomingItems = useMemo(
    () => buildUpcomingItems([...watchlist.to_watch.results, ...watchlist.up_to_date.results]),
    [watchlist]
  );

  // Day-wise grouping (user-requested): TODAY/TOMORROW/weekday/exact-date
  // headers, so an episode of one show and an episode of another show
  // releasing on the same day land under one shared header instead of an
  // undifferentiated flat list. See lib/upcoming.ts's groupUpcomingItemsByDate.
  const upcomingEntries = useMemo(
    () => groupUpcomingItemsByDate(upcomingItems, now),
    [upcomingItems, now]
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

  /** Grid card checkmark — the poster card has no collapse animation to
   *  defer to (unlike ShowRow's onAnimationComplete), so the store update
   *  fires immediately once we know the Catch-Up modal isn't intercepting. */
  const handleGridCheckPress = useCallback(
    async (
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
      const shown = await catchup.checkEpisode(showId, episodeId, showTitle, label);
      if (!shown) toggleWatchState(episodeId);
    },
    [catchup, toggleWatchState]
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
        <UpcomingSectionHeader label={entry.label} />
      ) : (
        <UpcomingRow item={entry.data} now={now} />
      ),
    [now]
  );

  const renderUpcomingGridEntry = useCallback(
    ({ item: entry }: { item: UpcomingListEntry }): React.ReactElement => {
      if (entry.type === 'header') return <UpcomingSectionHeader label={entry.label} />;
      const item = entry.data;
      const target = new Date(`${item.airDate}T00:00:00`);
      const { formatted, isImminent, dayOfWeek } = formatCountdown(target, now);
      return (
        <ShowPosterCard
          showId={item.tmdbShowId}
          title={item.showTitle}
          posterPath={item.posterPath}
          overlayBadge={`${formatted} (${dayOfWeek})`}
          overlayBadgeHighlighted={isImminent}
          subtitle={`S${pad(item.seasonNumber)}E${pad(item.episodeNumber)} · ${item.episodeTitle}`}
        />
      );
    },
    [now]
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
      {/* ── Header ──
          The global LayoutToggle only shows on WATCH LIST — UPCOMING has its
          own 3-way List/Grid/Calendar toggle below (see viewToggleRow), and
          stacking both read as two redundant, cluttered controls. */}
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Shows</Text>
        {activeTab === 'watchlist' && <LayoutToggle />}
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
                 key={`history-${preferredLayout}`}
                 data={history.results}
                 keyExtractor={(item) => item.id}
                 renderItem={({ item }) => <HistoryRow item={item} />}
                 estimatedItemSize={108}
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
                    ? "Every show in your list has been started."
                    : "No shows to watch next."}
                </Text>
              </GlassSurface>
            </View>
          ) : (
            <FlashList
              key={`watchlist-${preferredLayout}`}
              data={rows}
              keyExtractor={(item) => item.id}
              renderItem={preferredLayout === 'grid' ? renderGridRow : renderRow}
              numColumns={preferredLayout === 'grid' ? 2 : 1}
              extraData={preferredLayout}
              estimatedItemSize={preferredLayout === 'grid' ? 260 : 108}
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
              and Grid both drive the same global `preferredLayout` the
              header toggle drives on WATCH LIST, so a duplicate toggle
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
                if (preferredLayout !== 'list') toggleLayout();
              }}
              style={[
                styles.viewToggleBtn,
                upcomingView === 'list' &&
                  preferredLayout === 'list' && { backgroundColor: c.accentFill },
              ]}
              accessibilityRole="button"
              accessibilityLabel="List view"
              accessibilityState={{ selected: upcomingView === 'list' && preferredLayout === 'list' }}
            >
              <ListIcon
                color={
                  upcomingView === 'list' && preferredLayout === 'list' ? c.onAccent : c.textSecondary
                }
                size={16}
                strokeWidth={2.25}
              />
            </PressableScale>
            <PressableScale
              onPress={() => {
                setUpcomingView('list');
                if (preferredLayout !== 'grid') toggleLayout();
              }}
              style={[
                styles.viewToggleBtn,
                upcomingView === 'list' &&
                  preferredLayout === 'grid' && { backgroundColor: c.accentFill },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Grid view"
              accessibilityState={{ selected: upcomingView === 'list' && preferredLayout === 'grid' }}
            >
              <LayoutGrid
                color={
                  upcomingView === 'list' && preferredLayout === 'grid' ? c.onAccent : c.textSecondary
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
              key={`upcoming-${preferredLayout}`}
              data={upcomingEntries}
              keyExtractor={(entry) => entry.key}
              renderItem={preferredLayout === 'grid' ? renderUpcomingGridEntry : renderUpcomingEntry}
              getItemType={upcomingItemType}
              overrideItemLayout={preferredLayout === 'grid' ? upcomingOverrideLayout : undefined}
              numColumns={preferredLayout === 'grid' ? 2 : 1}
              extraData={preferredLayout}
              estimatedItemSize={preferredLayout === 'grid' ? 260 : 110}
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
  pillsScroll: { flexGrow: 0 },
  pillsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
    flexDirection: 'row',
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
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
