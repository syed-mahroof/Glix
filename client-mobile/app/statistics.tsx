// client-mobile/app/statistics.tsx
import { useRouter } from 'expo-router';
import { ArrowLeft, TrendingUp } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import MonthlySummaryCard from '../components/MonthlySummaryCard';
import PressableScale from '../components/PressableScale';
import { useAppTheme, type ThemeColors } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';

const TABS = ['Daily', 'Weekly', 'Monthly', 'Yearly'] as const;
type TabType = typeof TABS[number];

function BarChart({ data, labelKey, valueKey, c }: {
  data: any[];
  labelKey: string;
  valueKey: string;
  c: ThemeColors;
}) {
  const maxVal = Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={chartStyles.chart}>
        {data.map((item, idx) => {
          const pct = item[valueKey] / maxVal;
          return (
            <View key={idx} style={chartStyles.barCol}>
              <View style={[chartStyles.barTrack, { backgroundColor: c.trackRing }]}>
                <View
                  style={[
                    chartStyles.barFill,
                    { height: `${Math.max(pct * 100, 2)}%`, backgroundColor: c.accentFill },
                  ]}
                />
              </View>
              <Text style={[chartStyles.barLabel, { color: c.textTertiary }]} numberOfLines={1}>
                {item[labelKey]?.slice(0, 5) ?? ''}
              </Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

const chartStyles = StyleSheet.create({
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 120,
    gap: 4,
    paddingBottom: 20,
  },
  barCol: {
    alignItems: 'center',
    width: 28,
    height: 120,
    gap: 4,
  },
  barTrack: {
    flex: 1,
    width: 20,
    borderRadius: 3,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 3,
  },
  barLabel: {
    fontSize: 8,
    fontWeight: '600',
  },
});

export default function StatisticsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const fetchStatistics = useWatchStore((s) => s.fetchStatistics);
  const fetchMonthlyRecap = useWatchStore((s) => s.fetchMonthlyRecap);
  const statistics = useWatchStore((s) => s.statistics);
  const monthlyRecap = useWatchStore((s) => s.monthlyRecap);
  const isLoading = useWatchStore((s) => s.isLoadingAnalytics);

  const [activeTab, setActiveTab] = useState<TabType>('Monthly');

  useEffect(() => {
    fetchStatistics();
    fetchMonthlyRecap();
  }, [fetchStatistics, fetchMonthlyRecap]);

  const chartData = (() => {
    if (!statistics) return [];
    switch (activeTab) {
      case 'Daily':   return statistics.daily;
      case 'Weekly':  return statistics.weekly;
      case 'Monthly': return statistics.monthly;
      case 'Yearly':  return statistics.yearly;
    }
  })();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.headerRow}>
          <PressableScale onPress={() => router.back()} hitSlop={8}>
            <ArrowLeft color={c.textPrimary} size={22} />
          </PressableScale>
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Statistics</Text>
          {isLoading ? <ActivityIndicator color={c.accentInk} size="small" /> : <View style={{ width: 22 }} />}
        </View>

        {/* Watch time summary */}
        {statistics && (
          <View style={[styles.summaryCard, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
            <View style={styles.summaryRow}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>{statistics.watch_time.total_hours}h</Text>
                <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>Total</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>{statistics.watch_time.avg_minutes_per_day}m</Text>
                <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>Per Day</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>{statistics.watch_time.avg_minutes_per_week}m</Text>
                <Text style={[styles.summaryLabel, { color: c.textSecondary }]}>Per Week</Text>
              </View>
            </View>
            {statistics.most_watched_day && (
              <Text style={[styles.mostWatchedDay, { color: c.textSecondary }]}>
                Most active day: <Text style={{ color: c.accentInk }}>{statistics.most_watched_day}</Text>
              </Text>
            )}
          </View>
        )}

        {/* Chart period selector */}
        <View style={[styles.tabRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          {TABS.map((tab) => (
            <PressableScale
              key={tab}
              style={[styles.tab, activeTab === tab && { backgroundColor: c.accentFill }]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, { color: activeTab === tab ? c.onAccent : c.textSecondary }, activeTab === tab && styles.tabTextActive]}>
                {tab}
              </Text>
            </PressableScale>
          ))}
        </View>

        {/* Bar chart */}
        <View style={[styles.chartCard, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <Text style={[styles.chartTitle, { color: c.textPrimary }]}>Episodes Watched</Text>
          {chartData.length > 0 ? (
            <BarChart data={chartData} labelKey="label" valueKey="episodes_watched" c={c} />
          ) : (
            <Text style={[styles.emptyChart, { color: c.textTertiary }]}>No data yet</Text>
          )}
        </View>

        {/* Top shows */}
        {statistics && statistics.top_shows.length > 0 && (
          <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Top Shows</Text>
            {statistics.top_shows.map((show, idx) => (
              <View key={show.tmdb_id} style={styles.topShowRow}>
                <Text style={[styles.rank, { color: c.accentInk }]}>{idx + 1}</Text>
                <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={1}>{show.title}</Text>
                <Text style={[styles.showEps, { color: c.textTertiary }]}>{show.episodes_watched} eps</Text>
              </View>
            ))}
          </View>
        )}

        {/* Monthly recap */}
        {monthlyRecap.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Monthly Recap</Text>
            {monthlyRecap.filter((m) => m.episodes_watched > 0).map((item) => (
              <MonthlySummaryCard key={item.month} item={item} />
            ))}
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
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  summaryCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
    gap: 2,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  mostWatchedDay: {
    fontSize: 12,
    textAlign: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 3,
    gap: 2,
  },
  tab: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 9,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
  },
  tabTextActive: {
    fontWeight: '700',
  },
  chartCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  chartTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  emptyChart: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
  },
  topShowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rank: {
    fontSize: 14,
    fontWeight: '800',
    width: 18,
  },
  showTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  showEps: {
    fontSize: 11,
    fontWeight: '600',
  },
});
