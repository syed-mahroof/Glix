// client-mobile/app/achievements.tsx
// Phase 12: theme-aware + Aura-structure polish — an ambient glow behind the
// hero "earned / total" fraction and an entrance stagger on milestones and
// badges, matching analytics.tsx's dashboard treatment. No TrendChip here:
// unlike hours-watched, there's no prior-period achievements figure fetched
// to compare against, so a verdict chip would have to be invented rather
// than reused — skipped rather than forced.
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import AchievementCard from '../components/AchievementCard';
import AmbientGlow from '../components/AmbientGlow';
import MilestoneCard from '../components/MilestoneCard';
import PressableScale from '../components/PressableScale';
import { staggerEntering, usePrefersReducedMotion } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';

const CATEGORY_TABS = ['All', 'Earned', 'milestone', 'streak', 'binge', 'genre', 'time'] as const;
type CategoryTab = typeof CATEGORY_TABS[number];
const CATEGORY_LABELS: Record<CategoryTab, string> = {
  All: 'All',
  Earned: 'Earned',
  milestone: 'Milestones',
  streak: 'Streaks',
  binge: 'Binge',
  genre: 'Genre',
  time: 'Time',
};

const MILESTONE_SLUGS = new Set([
  'hundred_hours', 'five_hundred_hours', 'thousand_hours',
  'hundred_club', 'five_hundred_episodes', 'thousand_episodes',
  'hundred_shows',
]);

export default function AchievementsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const reduceMotion = usePrefersReducedMotion();
  const fetchAchievements = useWatchStore((s) => s.fetchAchievements);
  const achievements = useWatchStore((s) => s.achievements);
  const isLoading = useWatchStore((s) => s.isLoadingAnalytics);
  const [activeTab, setActiveTab] = useState<CategoryTab>('All');

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  const filteredItems = achievements.filter((item) => {
    if (activeTab === 'All') return true;
    if (activeTab === 'Earned') return item.earned;
    return item.category === activeTab;
  });

  const earnedCount = achievements.filter((a) => a.earned).length;

  // Split into milestone cards (count/time with progress rings) vs badge cards
  const milestones = filteredItems.filter((a) => MILESTONE_SLUGS.has(a.slug));
  const badges = filteredItems.filter((a) => !MILESTONE_SLUGS.has(a.slug));

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        data={badges}
        keyExtractor={(item) => item.slug}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View style={styles.headerRow}>
              <PressableScale onPress={() => router.back()} hitSlop={8}>
                <ArrowLeft color={c.textPrimary} size={22} />
              </PressableScale>
              <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Achievements</Text>
              {isLoading ? (
                <ActivityIndicator color={c.accentInk} size="small" />
              ) : (
                <View style={{ width: 22 }} />
              )}
            </View>

            {/* Progress summary */}
            <View style={[styles.progressCard, { backgroundColor: c.glassFill, borderColor: c.accentDim }]}>
              <AmbientGlow size={200} />
              <Text style={styles.progressFraction}>
                <Text style={{ color: c.accentInk }}>{earnedCount}</Text>
                <Text style={[styles.progressTotal, { color: c.textTertiary }]}> / {achievements.length}</Text>
              </Text>
              <Text style={[styles.progressLabel, { color: c.textSecondary }]}>Badges Earned</Text>
              <View style={[styles.progressTrack, { backgroundColor: c.trackRing }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: achievements.length > 0 ? `${(earnedCount / achievements.length) * 100}%` : '0%',
                      backgroundColor: c.accentFill,
                    },
                  ]}
                />
              </View>
            </View>

            {/* Category tabs */}
            <View style={styles.tabsScroll}>
              {CATEGORY_TABS.map((tab) => (
                <PressableScale
                  key={tab}
                  style={[
                    styles.tab,
                    { backgroundColor: c.glassFill, borderColor: c.hairline },
                    activeTab === tab && { backgroundColor: c.accentFill, borderColor: c.accentFill },
                  ]}
                  onPress={() => setActiveTab(tab)}
                >
                  <Text style={[styles.tabText, { color: activeTab === tab ? c.onAccent : c.textSecondary }]}>
                    {CATEGORY_LABELS[tab]}
                  </Text>
                </PressableScale>
              ))}
            </View>

            {/* Milestones section */}
            {milestones.length > 0 && (
              <>
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Milestones</Text>
                {milestones.map((item, index) => (
                  <Animated.View
                    key={item.slug}
                    entering={reduceMotion ? undefined : staggerEntering(index)}
                  >
                    <MilestoneCard
                      label={item.label}
                      description={item.description}
                      progress={item.progress}
                      progressLabel={item.progress_label}
                      earned={item.earned}
                    />
                  </Animated.View>
                ))}
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Badges</Text>
              </>
            )}
          </>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={reduceMotion ? undefined : staggerEntering(index)}>
            <AchievementCard item={item} />
          </Animated.View>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          !isLoading ? (
            <Text style={[styles.empty, { color: c.textTertiary }]}>
              {activeTab === 'Earned' ? 'Keep watching to earn badges!' : 'No badges in this category.'}
            </Text>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 48,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  progressCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
    overflow: 'hidden',
  },
  progressFraction: {
    fontSize: 36,
    fontWeight: '900',
  },
  progressTotal: {
    fontSize: 22,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  tabsScroll: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 4,
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  empty: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
