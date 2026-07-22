// client-mobile/app/profile/shows.tsx
// Phase 5: Profile > My Shows — full watchlist with filter pills.

import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, BookOpen, Languages, Search, Tv2, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import LanguageFilterModal, { languageDisplayName } from '../../components/LanguageFilterModal';
import LayoutToggle from '../../components/LayoutToggle';
import PressableScale from '../../components/PressableScale';
import ShowPosterCard from '../../components/ShowPosterCard';
import { useAppTheme, type ThemeColors } from '../../lib/theme';
import { WatchlistEntry } from '../../store/watchStore';
import { useWatchStore } from '../../store/watchStore';

const POSTER_BASE = 'https://image.tmdb.org/t/p/w185';

type FilterKey = 'ALL' | 'UP_TO_DATE' | 'TO_WATCH' | 'ENDED';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'TO_WATCH', label: 'Continuing' },
  { key: 'UP_TO_DATE', label: 'Up to Date' },
  { key: 'ENDED', label: 'Ended' },
];

function statusColor(entry: WatchlistEntry, c: ThemeColors): string {
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

function statusLabel(entry: WatchlistEntry): string {
  if (entry.show.status === 'ENDED') return 'Ended';
  switch (entry.status) {
    case 'UP_TO_DATE': return 'Up to Date';
    case 'ARCHIVED': return 'Stopped';
    default: return 'Continuing';
  }
}

function ShowListRow({ entry }: { entry: WatchlistEntry }) {
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

function ShowGridCard({ entry }: { entry: WatchlistEntry }) {
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
  const preferredLayout = useWatchStore((s) => s.preferredLayout);
  const selectedLanguage = useWatchStore((s) => s.selectedLanguage);
  const setLanguageFilter = useWatchStore((s) => s.setLanguageFilter);
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [query, setQuery] = useState('');
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState(false);

  useEffect(() => {
    fetchWatchlist();
  }, [fetchWatchlist]);

  const allEntries = useMemo(() => {
    return [
      ...watchlist.to_watch.results,
      ...watchlist.up_to_date.results,
      ...watchlist.archived.results,
    ];
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
    if (filter === 'UP_TO_DATE') result = result.filter((e) => e.status === 'UP_TO_DATE' && e.show.status !== 'ENDED');
    else if (filter === 'TO_WATCH') result = result.filter((e) => e.status === 'TO_WATCH' && e.show.status !== 'ENDED');
    else if (filter === 'ENDED') result = result.filter((e) => e.show.status === 'ENDED');

    if (selectedLanguage) {
      result = result.filter((e) => e.show.original_language === selectedLanguage);
    }

    const trimmedQuery = query.trim().toLowerCase();
    if (trimmedQuery) {
      result = result.filter((e) => e.show.title.toLowerCase().includes(trimmedQuery));
    }
    return result;
  }, [allEntries, filter, selectedLanguage, query]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <PressableScale
          style={[styles.backBtn, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
          onPress={() => router.back()}
        >
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <View style={styles.headerCenter}>
          <Tv2 color={c.accentInk} size={20} strokeWidth={1.75} />
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>My Shows</Text>
        </View>
        <LayoutToggle />
      </View>

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
            <PressableScale onPress={() => setQuery('')} hitSlop={8}>
              <X color={c.textTertiary} size={16} />
            </PressableScale>
          )}
        </View>
      </View>

      {/* Filter Pills */}
      <View style={styles.pillRow}>
        {FILTERS.map(({ key, label }) => (
          <PressableScale
            key={key}
            style={[
              styles.pill,
              { backgroundColor: c.glassFill, borderColor: c.hairline },
              filter === key && { backgroundColor: c.accentFill, borderColor: c.accentFill },
            ]}
            onPress={() => setFilter(key)}
          >
            <Text style={[styles.pillText, { color: c.textSecondary }, filter === key && { color: c.onAccent }]}>
              {label}
            </Text>
          </PressableScale>
        ))}
        <PressableScale
          style={[
            styles.pill,
            styles.languagePill,
            { backgroundColor: c.glassFill, borderColor: c.hairline },
            selectedLanguage && { backgroundColor: c.accentFill, borderColor: c.accentFill },
          ]}
          onPress={() => setIsLanguageModalVisible(true)}
        >
          <Languages color={selectedLanguage ? c.onAccent : c.textSecondary} size={14} />
          <Text style={[styles.pillText, { color: c.textSecondary }, selectedLanguage && { color: c.onAccent }]}>
            {selectedLanguage ? languageDisplayName(selectedLanguage) : 'Language'}
          </Text>
        </PressableScale>
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
              : filter === 'ALL' && !selectedLanguage
              ? 'Start tracking shows from the Discover tab.'
              : 'No shows match this filter.'}
          </Text>
        </View>
      ) : (
        <View style={styles.listWrap}>
          <FlashList
            key={`profile-shows-${preferredLayout}`}
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            // List: 110, not the posterWrap's own 96 — rowContent's padding
            // (24) + its 4 stacked children (title/status pill/progress
            // bar/episode count) run slightly taller than the poster, plus
            // the row's own marginBottom (10). Matches the ShowRow/MovieRow/
            // UpcomingRow convention elsewhere of poster + margin, not a
            // bare poster-height guess.
            estimatedItemSize={preferredLayout === 'grid' ? 260 : 110}
            numColumns={preferredLayout === 'grid' ? 2 : 1}
            extraData={preferredLayout}
            renderItem={({ item }) =>
              preferredLayout === 'grid' ? <ShowGridCard entry={item} /> : <ShowListRow entry={item} />
            }
            contentContainerStyle={styles.listContent}
            refreshing={isLoadingWatchlist}
            onRefresh={fetchWatchlist}
          />
        </View>
      )}
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
  pillRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  languagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
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
