// client-mobile/app/year-review.tsx
// Phase 12: theme-aware + Aura-structure polish — ambient glow behind the
// hero hours-watched number and an entrance stagger on the stat carousel
// and the top-shows/top-genres rows, matching analytics.tsx's dashboard
// treatment. No TrendChip: this screen doesn't fetch a prior-year figure to
// compare hours against, so a verdict chip would have nothing real to show.
import { useRouter } from 'expo-router';
import {
  Activity,
  ArrowLeft,
  Calendar,
  Film,
  Flame,
  Star,
  Trophy,
} from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import AmbientGlow from '../components/AmbientGlow';
import PressableScale from '../components/PressableScale';
import YearReviewCard from '../components/YearReviewCard';
import { staggerEntering, usePrefersReducedMotion } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';

// Pre-existing non-token accent hues used to give each Year-in-Review card
// its own identity across the carousel — not new colors introduced by the
// Phase 12 migration, kept as-is per AI_RULES.md verification guidance for
// "pre-existing non-token colors unrelated to light/dark."
const ACCENT_CORAL = '#FF6B6B';
const ACCENT_BLUE = '#4ECDC4';
const ACCENT_PURPLE = '#C77DFF';

const CURRENT_YEAR = new Date().getFullYear();

const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w185';

export default function YearReviewScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const reduceMotion = usePrefersReducedMotion();
  const fetchYearReview = useWatchStore((s) => s.fetchYearReview);
  const yearReview = useWatchStore((s) => s.yearReview);
  const isLoading = useWatchStore((s) => s.isLoadingAnalytics);

  useEffect(() => {
    fetchYearReview(CURRENT_YEAR);
  }, [fetchYearReview]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <PressableScale onPress={() => router.back()} hitSlop={8}>
            <ArrowLeft color={c.textPrimary} size={22} />
          </PressableScale>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]}>{CURRENT_YEAR}</Text>
            <Text style={[styles.headerSub, { color: c.textTertiary }]}>Year in Review</Text>
          </View>
          {isLoading ? (
            <ActivityIndicator color={c.accentInk} size="small" />
          ) : (
            <View style={{ width: 22 }} />
          )}
        </View>

        {isLoading && !yearReview ? (
          <View style={styles.loadingState}>
            <ActivityIndicator color={c.accentInk} size="large" />
            <Text style={[styles.loadingText, { color: c.textTertiary }]}>Crunching your year...</Text>
          </View>
        ) : !yearReview ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>🎬</Text>
            <Text style={[styles.emptyTitle, { color: c.textPrimary }]}>Nothing to review yet</Text>
            <Text style={[styles.emptyDesc, { color: c.textTertiary }]}>Start watching to build your year in review.</Text>
          </View>
        ) : (
          <>
            {/* Hero — hours watched */}
            <View style={[styles.heroCard, { backgroundColor: c.glassFill, borderColor: c.accentDim }]}>
              <AmbientGlow size={240} />
              <Text style={[styles.heroLabel, { color: c.textSecondary }]}>You watched</Text>
              <Text style={[styles.heroValue, { color: c.accentInk }]}>{yearReview.hours_watched}h</Text>
              <Text style={[styles.heroSub, { color: c.textSecondary }]}>
                across {yearReview.episodes_watched} episodes
              </Text>
            </View>

            {/* Horizontal card carousel — sequenced entrance */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carousel}>
              {[
                yearReview.most_watched_show && (
                  <YearReviewCard
                    key="most-watched"
                    label="Most Watched Show"
                    value={yearReview.most_watched_show.title}
                    sublabel={`${yearReview.most_watched_show.episodes_watched} episodes`}
                    Icon={Star}
                  />
                ),
                yearReview.favorite_genre && (
                  <YearReviewCard
                    key="favorite-genre"
                    label="Favourite Genre"
                    value={yearReview.favorite_genre}
                    Icon={Film}
                    accentColor={ACCENT_CORAL}
                  />
                ),
                <YearReviewCard
                  key="shows-finished"
                  label="Shows Finished"
                  value={String(yearReview.shows_finished)}
                  Icon={Trophy}
                  accentColor={ACCENT_BLUE}
                />,
                yearReview.longest_streak > 0 && (
                  <YearReviewCard
                    key="longest-streak"
                    label="Longest Streak"
                    value={`${yearReview.longest_streak} days`}
                    Icon={Flame}
                    accentColor={ACCENT_CORAL}
                  />
                ),
                yearReview.biggest_month && (
                  <YearReviewCard
                    key="biggest-month"
                    label="Biggest Month"
                    value={yearReview.biggest_month}
                    Icon={Calendar}
                    accentColor={ACCENT_PURPLE}
                  />
                ),
                yearReview.favorite_actor && (
                  <YearReviewCard
                    key="favorite-actor"
                    label="Favourite Character"
                    value={yearReview.favorite_actor}
                    Icon={Activity}
                    accentColor={ACCENT_BLUE}
                  />
                ),
              ]
                .filter((card): card is React.ReactElement => Boolean(card))
                .map((card, index) => (
                  <Animated.View key={card.key} entering={reduceMotion ? undefined : staggerEntering(index)}>
                    {card}
                  </Animated.View>
                ))}
            </ScrollView>

            {/* Top 5 shows */}
            {yearReview.top_shows.length > 0 && (
              <View style={[styles.listCard, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Text style={[styles.listTitle, { color: c.textPrimary }]}>Top 5 Shows This Year</Text>
                {yearReview.top_shows.map((show, idx) => (
                  <View key={show.tmdb_id} style={styles.showRow}>
                    <Text style={[styles.showRank, { color: c.accentInk }]}>{idx + 1}</Text>
                    {show.poster_path ? (
                      <Image
                        source={{ uri: `${TMDB_IMAGE}${show.poster_path}` }}
                        style={[styles.showPoster, { backgroundColor: c.trackRing }]}
                      />
                    ) : (
                      <View style={[styles.showPosterPlaceholder, { backgroundColor: c.trackRing }]} />
                    )}
                    <View style={styles.showMeta}>
                      <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={1}>{show.title}</Text>
                      <Text style={[styles.showEps, { color: c.textTertiary }]}>{show.episodes_watched} episodes</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Top genres */}
            {yearReview.top_genres.length > 0 && (
              <View style={[styles.listCard, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Text style={[styles.listTitle, { color: c.textPrimary }]}>Top Genres</Text>
                {yearReview.top_genres.map((g, idx) => (
                  <View key={g.genre} style={styles.genreRow}>
                    <Text style={[styles.showRank, { color: c.accentInk }]}>{idx + 1}</Text>
                    <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={1}>{g.genre}</Text>
                    <Text style={[styles.showEps, { color: c.textTertiary }]}>{g.count} eps</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  headerCenter: { alignItems: 'center' },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '500',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    gap: 10,
  },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyDesc: {
    fontSize: 13,
    textAlign: 'center',
  },
  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  heroLabel: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  heroValue: {
    fontSize: 80,
    fontWeight: '900',
    letterSpacing: -3,
    lineHeight: 84,
  },
  heroSub: {
    fontSize: 14,
    fontWeight: '500',
  },
  carousel: {
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  listCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  listTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  showRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  showRank: {
    fontSize: 15,
    fontWeight: '800',
    width: 20,
    textAlign: 'center',
  },
  showPoster: {
    width: 36,
    height: 52,
    borderRadius: 6,
  },
  showPosterPlaceholder: {
    width: 36,
    height: 52,
    borderRadius: 6,
  },
  showMeta: { flex: 1, gap: 2 },
  showTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  showEps: {
    fontSize: 11,
  },
  genreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
