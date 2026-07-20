// client-mobile/app/analytics.tsx
// Phase 12: theme-aware + Aura-structure polish — mono precision labels,
// entrance stagger on the quick-stats row, an ambient glow behind the hero
// number, and a trend chip verdict on hours watched vs. last month.

import { useRouter } from 'expo-router';
import {
  Activity,
  ArrowLeft,
  ChevronRight,
  Flame,
  Trophy,
} from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import AmbientGlow from '../components/AmbientGlow';
import CompletionRateCard from '../components/CompletionRateCard';
import GenreChart from '../components/GenreChart';
import GlassSurface from '../components/GlassSurface';
import PressableScale from '../components/PressableScale';
import StatsCard from '../components/StatsCard';
import TimeWatchedCard from '../components/TimeWatchedCard';
import TrendChip from '../components/TrendChip';
import WatchHeatmap from '../components/WatchHeatmap';
import WatchStreakCard from '../components/WatchStreakCard';
import { staggerEntering, usePrefersReducedMotion } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import { monoLabelStyle } from '../lib/typography';
import { useWatchStore } from '../store/watchStore';

function NavRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale onPress={onPress}>
      <GlassSurface radius={14} style={styles.navRow}>
        <Text style={[styles.navRowText, { color: c.textPrimary }]}>{label}</Text>
        <ChevronRight color={c.textTertiary} size={18} />
      </GlassSurface>
    </PressableScale>
  );
}

export default function AnalyticsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const reduceMotion = usePrefersReducedMotion();

  const fetchDashboard = useWatchStore((s) => s.fetchDashboard);
  const fetchGenres = useWatchStore((s) => s.fetchGenres);
  const fetchHeatmap = useWatchStore((s) => s.fetchHeatmap);
  const fetchStreak = useWatchStore((s) => s.fetchStreak);
  const fetchCompletion = useWatchStore((s) => s.fetchCompletion);
  const fetchMonthlyRecap = useWatchStore((s) => s.fetchMonthlyRecap);

  const dashboard = useWatchStore((s) => s.dashboard);
  const genres = useWatchStore((s) => s.genres);
  const heatmap = useWatchStore((s) => s.heatmap);
  const streak = useWatchStore((s) => s.streak);
  const completion = useWatchStore((s) => s.completion);
  const monthlyRecap = useWatchStore((s) => s.monthlyRecap);
  const isLoading = useWatchStore((s) => s.isLoadingAnalytics);

  useEffect(() => {
    fetchDashboard();
    fetchGenres();
    fetchHeatmap();
    fetchStreak();
    fetchCompletion();
    fetchMonthlyRecap();
  }, [fetchDashboard, fetchGenres, fetchHeatmap, fetchStreak, fetchCompletion, fetchMonthlyRecap]);

  const totalHoursWhole = Math.floor(dashboard?.total_hours_watched ?? 0);

  // Trend verdict on hours watched vs. the previous month — reuses data
  // already fetched for Year in Review / Monthly Summary, no new endpoint.
  const hoursTrend = useMemo(() => {
    if (monthlyRecap.length < 2) return null;
    const sorted = [...monthlyRecap].sort((a, b) => a.month.localeCompare(b.month));
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    if (!prev.hours_watched) return null;
    const pct = Math.round(((last.hours_watched - prev.hours_watched) / prev.hours_watched) * 100);
    if (pct === 0) return { direction: 'flat' as const, label: 'flat vs last month' };
    return { direction: (pct > 0 ? 'up' : 'down') as 'up' | 'down', label: `${Math.abs(pct)}% vs last month` };
  }, [monthlyRecap]);

  const quickStats = [
    { label: 'Shows Done', value: dashboard?.shows_completed ?? 0, Icon: Trophy },
    { label: 'Streak', value: `${dashboard?.current_streak ?? 0}d`, Icon: Flame },
    { label: 'Best Streak', value: `${dashboard?.longest_streak ?? 0}d`, Icon: Activity },
  ];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <PressableScale onPress={() => router.back()} hitSlop={8}>
              <ArrowLeft color={c.textPrimary} size={22} />
            </PressableScale>
            <View>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Analytics</Text>
              <Text style={[styles.headerSub, { color: c.textTertiary }]}>Your watch history at a glance</Text>
            </View>
          </View>
          {isLoading && <ActivityIndicator color={c.accentInk} size="small" />}
        </View>

        {/* Hero stat */}
        <GlassSurface radius={20} level={2} style={[styles.heroCard, { borderColor: c.accentDim }]}>
          <AmbientGlow size={260} />
          <Text style={[styles.heroValue, { color: c.accentInk }]}>{totalHoursWhole}</Text>
          <View style={styles.heroUnitRow}>
            <Text style={[styles.heroUnit, monoLabelStyle, { color: c.textSecondary }]}>hours watched</Text>
            {hoursTrend && (
              <TrendChip direction={hoursTrend.direction} label={hoursTrend.label} />
            )}
          </View>
          <View style={[styles.heroDivider, { backgroundColor: c.hairline }]} />
          <View style={styles.heroSubStats}>
            <View style={styles.heroSubStat}>
              <Text style={[styles.heroSubValue, { color: c.textPrimary }]}>{dashboard?.total_episodes_watched ?? 0}</Text>
              <Text style={[styles.heroSubLabel, monoLabelStyle, { color: c.textTertiary }]}>Episodes</Text>
            </View>
            <View style={styles.heroSubStat}>
              <Text style={[styles.heroSubValue, { color: c.textPrimary }]}>{dashboard?.total_shows_tracked ?? 0}</Text>
              <Text style={[styles.heroSubLabel, monoLabelStyle, { color: c.textTertiary }]}>Shows</Text>
            </View>
            <View style={styles.heroSubStat}>
              <Text style={[styles.heroSubValue, { color: c.textPrimary }]}>{dashboard?.badges_earned ?? 0}</Text>
              <Text style={[styles.heroSubLabel, monoLabelStyle, { color: c.textTertiary }]}>Badges</Text>
            </View>
          </View>
        </GlassSurface>

        {/* Time breakdown */}
        <TimeWatchedCard
          days={Math.floor((dashboard?.total_minutes_watched ?? 0) / 1440)}
          hours={Math.floor(((dashboard?.total_minutes_watched ?? 0) % 1440) / 60)}
          minutes={(dashboard?.total_minutes_watched ?? 0) % 60}
        />

        {/* Quick stats row — sequenced entrance, not a dump */}
        <View style={styles.statsRow}>
          {quickStats.map((stat, index) => (
            <Animated.View
              key={stat.label}
              entering={reduceMotion ? undefined : staggerEntering(index)}
              style={styles.statCard}
            >
              <StatsCard label={stat.label} value={stat.value} Icon={stat.Icon} />
            </Animated.View>
          ))}
        </View>

        {/* Streak card */}
        {streak && (
          <WatchStreakCard
            currentStreak={streak.current_streak}
            longestStreak={streak.longest_streak}
            totalDays={streak.total_streak_days}
            recentActivity={streak.recent_activity}
          />
        )}

        {/* Completion rings */}
        {completion && (
          <CompletionRateCard
            episodePct={completion.episode_completion_pct}
            seasonPct={completion.season_completion_pct}
            showPct={completion.show_completion_pct}
            moviePct={0}
          />
        )}

        {/* Genre chart */}
        {genres.length > 0 && <GenreChart data={genres} />}

        {/* Heatmap */}
        {heatmap.length > 0 && <WatchHeatmap data={heatmap} />}

        {/* Navigation rows */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>More Insights</Text>
        <NavRow label="Detailed Statistics" onPress={() => router.push('/statistics')} />
        <NavRow label="Achievements & Badges" onPress={() => router.push('/achievements')} />
        <NavRow label="Year in Review" onPress={() => router.push('/year-review')} />
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
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  headerSub: {
    fontSize: 13,
    marginTop: 2,
  },
  heroCard: {
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    gap: 4,
  },
  heroValue: {
    fontSize: 72,
    fontWeight: '900',
    letterSpacing: -3,
    lineHeight: 76,
  },
  heroUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  heroUnit: {
    fontSize: 13,
  },
  heroDivider: {
    width: '100%',
    height: StyleSheet.hairlineWidth,
    marginVertical: 12,
  },
  heroSubStats: {
    flexDirection: 'row',
    gap: 32,
  },
  heroSubStat: {
    alignItems: 'center',
    gap: 2,
  },
  heroSubValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  heroSubLabel: {
    fontSize: 10,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navRowText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
