// client-mobile/app/profile/shows.tsx
// Phase 5: Profile > My Shows — full watchlist with filter pills.

import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, BookOpen, Search, Tv2, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import FloatingFilterButton from '../../components/FloatingFilterButton';
import LanguageFilterModal, { languageDisplayName } from '../../components/LanguageFilterModal';
import LayoutToggle from '../../components/LayoutToggle';
import PressableScale from '../../components/PressableScale';
import ShowPosterCard from '../../components/ShowPosterCard';
import TabPill from '../../components/TabPill';
import WatchlistFilterSheet from '../../components/WatchlistFilterSheet';
import { isAnimeByGenresAndLanguage } from '../../lib/anime';
import { clearFlashListLayoutCacheOnChange } from '../../lib/flashListLayout';
import { useAppTheme, type ThemeColors } from '../../lib/theme';
import { WatchlistEntry } from '../../store/watchStore';
import { useWatchStore } from '../../store/watchStore';
import { useLayoutFor } from '../../store/preferencesStore';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185';

// "Up to Date" was dropped as a status filter (Phase 57) in favor of a
// "Last Watched" sort. Phase 63 folded that sort back into this same
// single-select tab row as its own option (rather than a second
// independent toggle living in the filter sheet) — selecting it doesn't
// narrow the list by status, it just sorts the full list by recency. The
// per-item "Up to Date" status badge (statusLabel/statusColor below) is
// untouched either way.
type FilterKey = 'ALL' | 'TO_WATCH' | 'LAST_WATCHED' | 'ENDED';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TO_WATCH', label: 'Continuing' },
  { key: 'LAST_WATCHED', label: 'Last Watched' },
  { key: 'ENDED', label: 'Ended' },
];

export function statusColor(entry: WatchlistEntry, c: ThemeColors): string {
  // Was hardcoded '#888'/'#4CAF50' (grey/green) in 3 of 4 branches despite
  // already taking `c` as a param for exactly this — a third/fourth hue
  // outside Phase 12's locked accent+error rule. ENDED/ARCHIVED are both
  // "inactive, deprioritized" states -> textTertiary; UP_TO_DATE matches
  // the "done" convention used everywhere else in the app (checkmarks,
  // progress rings) -> accentInk, same as the pre-existing default branch.
  if (entry.show.status === 'ENDED') return c.textTertiary;
  switch (entry.status) {
    case 'UP_TO_DATE': return c.accentInk;
    case 'ARCHIVED': return c.textTertiary;
    default: return c.accentInk;
  }
}

export function statusLabel(entry: WatchlistEntry): string {
  if (entry.show.status === 'ENDED') return 'Ended';
  switch (entry.status) {
    case 'UP_TO_DATE': return 'Up to Date';
    case 'ARCHIVED': return 'Stopped';
    default: return 'Continuing';
  }
}

export function ShowListRow({ entry }: { entry: WatchlistEntry }) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
      onPress={() => router.push(`/show/${entry.show.tmdb_id}` as any)}
    >
      {/* Poster */}
      <View style={[styles.posterWrap, { backgroundColor: c.bgElevated }]}>
        <Image
          source={
            entry.show.poster_path
              ? { uri: `${POSTER_BASE}${entry.show.poster_path}` }
              : undefined
          }
          style={styles.poster}
          contentFit="cover"
          transition={200}
        />
      </View>

      {/* Info */}
      <View style={styles.rowContent}>
        <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={2}>
          {entry.show.title}
        </Text>

        {/* Status pill */}
        <View
          style={[
            styles.statusPill,
            { borderColor: statusColor(entry, c) + '55' },
          ]}
        >
          <View
            style={[styles.statusDot, { backgroundColor: statusColor(entry, c) }]}
          />
          <Text style={[styles.statusText, { color: statusColor(entry, c) }]}>
            {statusLabel(entry)}
          </Text>
        </View>

        {/* Progress bar */}
        <View style={[styles.progressTrack, { backgroundColor: c.trackRing }]}>
          <View
            style={[
              styles.progressFill,
              { backgroundColor: c.accentFill },
              { width: `${Math.min(entry.progress_percentage, 100)}%` as any },
            ]}
          />
        </View>

        {/* Episode count */}
        <Text style={[styles.episodeCount, { color: c.textSecondary }]}>
          {entry.watched_episode_count} / {entry.aired_episode_count} episodes
        </Text>
      </View>
    </PressableScale>
  );
}

export function ShowGridCard({ entry }: { entry: WatchlistEntry }) {
  return (
    <ShowPosterCard
      showId={entry.show.tmdb_id}
      title={entry.show.title}
      posterPath={entry.show.poster_path}
      overlayBadge={statusLabel(entry)}
      subtitle={`${entry.watched_episode_count} / ${entry.aired_episode_count} episodes`}
      progressPercentage={entry.progress_percentage}
    />
  );
}

export default function ProfileShowsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  // Scoped selectors, not a bare useWatchStore() — see app/_layout.tsx's note.
  const watchlist = useWatchStore((s) => s.watchlist);
  const isLoadingWatchlist = useWatchStore((s) => s.isLoadingWatchlist);
  const fetchWatchlist = useWatchStore((s) => s.fetchWatchlist);
  const layout = useLayoutFor('myShows');
  const selectedLanguage = useWatchStore((s) => s.selectedLanguage);
  const setLanguageFilter = useWatchStore((s) => s.setLanguageFilter);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState(false);
  const [isFilterSheetVisible, setIsFilterSheetVisible] = useState(false);
  const listRef = useRef<FlashListRef<WatchlistEntry>>(null);
  const previousLayoutRef = useRef(layout);

  if (previousLayoutRef.current !== layout) {
    previousLayoutRef.current = clearFlashListLayoutCacheOnChange(
      previousLayoutRef.current,
      layout,
      listRef
    );
  }
  // Derived from the tab selection, not independent state — Last Watched
  // is one of the single-select FILTERS options now (Phase 63), not a
  // second toggle that could be active alongside Continuing/Ended.
  const lastWatchedSort = filter === 'LAST_WATCHED';

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  // Anime shows now live exclusively under My Anime (Phase 75.2) — excluded
  // here unconditionally, not via an optional toggle, so this list and that
  // one never overlap.
  const allEntries = useMemo(() => {
    return [
      ...watchlist.to_watch.results,
      ...watchlist.up_to_date.results,
      ...watchlist.archived.results,
    ].filter((e) => !isAnimeByGenresAndLanguage(e.show.genres, e.show.original_language));
  }, [watchlist]);

  // Distinct languages present in the user's own cached watchlist — never
  // TMDB's full language list, and never a new request (client-side only).
  const availableLanguages = useMemo(() => {
    const codes = new Set<string>();
    allEntries.forEach((e) => {
      if (e.show.original_language) codes.add(e.show.original_language);
    });
    return Array.from(codes).sort();
  }, [allEntries]);

  const filtered = useMemo(() => {
    let result = allEntries;
    if (filter === 'TO_WATCH') result = result.filter((e) => e.status === 'TO_WATCH' && e.show.status !== 'ENDED');
    else if (filter === 'ENDED') result = result.filter((e) => e.show.status === 'ENDED');

    if (selectedLanguage) {
      result = result.filter((e) => e.show.original_language === selectedLanguage);
    }

    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery) {
      result = result.filter((e) => e.show.title.toLowerCase().includes(trimmedQuery));
    }

    if (lastWatchedSort) {
      // Never-watched entries (null last_watched_at) sink to the bottom,
      // most-recently-watched first — matches the field's own semantics
      // (Phase 41: bumped only on a real mark-watched action).
      result = [...result].sort((a, b) => {
        if (!a.last_watched_at && !b.last_watched_at) return 0;
        if (!a.last_watched_at) return 1;
        if (!b.last_watched_at) return -1;
        return b.last_watched_at.localeCompare(a.last_watched_at);
      });
    }
    return result;
  }, [allEntries, filter, selectedLanguage, query, lastWatchedSort]);

  const hasActiveFilters = filter !== 'ALL' || selectedLanguage !== null;

  const handleReset = () => {
    setFilter('ALL');
    setLanguageFilter(null);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <PressableScale
          style={[styles.backBtn, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <View style={styles.headerCenter}>
          <Tv2 color={c.accentInk} size={20} strokeWidth={1.75} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>My Shows</Text>
        </View>
        <LayoutToggle scope="myShows" />
      </View>

      {/* Status/sort tabs — a normal top-of-screen horizontal pill row
          again (Phase 63), not a filter-sheet section. Single-select;
          tapping the already-active pill returns to "All". */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabsContainer}
        style={styles.tabsScroll}
      >
        {FILTERS.map((f) => (
          <TabPill
            key={f.key}
            label={f.label}
            active={filter === f.key}
            onPress={() => setFilter(filter === f.key ? 'ALL' : f.key)}
          />
        ))}
      </ScrollView>

      {/* Search — client-side filter over the already-loaded watchlist page
          (same page-1-per-bucket scope the rest of this screen has). */}
      <View style={styles.searchRow}>
        <View style={[styles.searchInputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <Search color={c.textTertiary} size={16} />
          <TextInput
            style={[styles.searchInput, { color: c.textPrimary }]}
            placeholder="Search your shows"
            placeholderTextColor={c.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <PressableScale
              onPress={() => setQuery('')}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Clear search"
            >
              <X color={c.textTertiary} size={16} />
            </PressableScale>
          )}
        </View>
      </View>

      <LanguageFilterModal
        visible={isLanguageModalVisible}
        languages={availableLanguages}
        selected={selectedLanguage}
        onSelect={setLanguageFilter}
        onClose={() => setIsLanguageModalVisible(false)}
      />

      {/* List */}
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <BookOpen color={c.textTertiary} size={48} strokeWidth={1.25} />
          <Text style={[styles.emptyTitle, { color: c.textSecondary }]}>
            {query.trim() ? 'No matches' : 'No shows here yet'}
          </Text>
          <Text style={[styles.emptySubtitle, { color: c.textTertiary }]}>
            {query.trim()
              ? `No shows match "${query.trim()}".`
              : !hasActiveFilters
              ? 'Start tracking shows from the Discover tab.'
              : 'No shows match this filter.'}
          </Text>
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlashList
            // Perf fix (2026-08-07): no remount needed for a numColumns
            // change — see (tabs)/index.tsx's identical note.
            ref={listRef}
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            numColumns={layout === 'grid' ? 3 : 1}
            getItemType={() => layout}
            estimatedItemSize={layout === 'grid' ? 230 : 108}
            extraData={layout}
            renderItem={({ item }) =>
              layout === 'grid' ? <ShowGridCard entry={item} /> : <ShowListRow entry={item} />
            }
            contentContainerStyle={styles.listContent}
            refreshing={isLoadingWatchlist}
            onRefresh={fetchWatchlist}
          />
        </View>
      )}

      {/* Filter sheet — rendered last (after the list), not before it. React
          Native has no implicit z-index across siblings: an earlier sibling
          with `position: absolute` still paints underneath a later one, so
          mounting this before the FlashList (the Phase 57/63 bug) let the
          list's own paint pass draw over the sheet despite it being a
          correct full-screen overlay. Matches DiscoverFilterSheet's own
          placement in discover.tsx. */}
      <WatchlistFilterSheet
        visible={isFilterSheetVisible}
        onClose={() => setIsFilterSheetVisible(false)}
        title="Filter Shows"
        selectedLanguage={selectedLanguage}
        onOpenLanguagePicker={() => setIsLanguageModalVisible(true)}
        languageDisplay={selectedLanguage ? languageDisplayName(selectedLanguage) : 'Any Language'}
        tagToggles={[]}
        hasActiveFilters={hasActiveFilters}
        onReset={handleReset}
      />

      <FloatingFilterButton onPress={() => setIsFilterSheetVisible(true)} active={hasActiveFilters} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },

  tabsScroll: {
    flexGrow: 0,
    marginBottom: 12,
  },
  tabsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },

  searchRow: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  searchInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  listWrap: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },

  row: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 10,
    overflow: 'hidden',
  },
  posterWrap: {
    width: 64,
    height: 96,
  },
  poster: { width: '100%', height: '100%' },

  rowContent: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    justifyContent: 'center',
  },
  showTitle: {
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 20,
  },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  progressTrack: {
    height: 3,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
  },

  episodeCount: {
    fontSize: 12,
    fontWeight: '500',
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
    marginTop: -60,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
  },
});
