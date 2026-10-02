import { Calculator, ChevronDown, ChevronUp } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useAppTheme } from '../lib/theme';
import { formatWatchMinutes, planSeries, seriesWorkload } from '../lib/watchPlan';
import type { Show, WatchlistEntry } from '../store/watchStore';
import GlassSurface from './GlassSurface';
import PressableScale from './PressableScale';

export default function SeriesWatchCalculator({ show, entry }: { show: Show; entry: WatchlistEntry | null }) {
  const { theme: { colors: c } } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const [wholeSeries, setWholeSeries] = useState(false);
  const [dailyBudget, setDailyBudget] = useState('60');
  const [weekdaysOnly, setWeekdaysOnly] = useState(false);
  const workload = useMemo(() => seriesWorkload(entry?.show.episodes ?? show.episodes, show.total_episodes, entry?.watched_episode_count ?? 0, wholeSeries), [entry?.show.episodes, entry?.watched_episode_count, show.episodes, show.total_episodes, wholeSeries]);
  const budget = /^\d{1,4}$/.test(dailyBudget) ? Number(dailyBudget) : NaN;
  const plan = planSeries(workload, budget, weekdaysOnly);
  const summary = workload.episodes === 0 ? 'All caught up' : `${formatWatchMinutes(workload.minutes)} · ${workload.episodes} episodes ${wholeSeries ? 'total' : 'left'}`;
  return (
    <GlassSurface radius={18} style={styles.card}>
      <PressableScale accessibilityRole="button" accessibilityState={{ expanded }} accessibilityLabel="Series watch calculator" onPress={() => setExpanded(!expanded)} style={styles.heading}>
        <Calculator color={c.accentInk} size={22} />
        <View style={{ flex: 1 }}><Text style={[styles.title, { color: c.textPrimary }]}>Plan your watch</Text><Text style={[styles.caption, { color: c.textSecondary }]}>{summary}</Text></View>
        {expanded ? <ChevronUp size={20} color={c.textSecondary} /> : <ChevronDown size={20} color={c.textSecondary} />}
      </PressableScale>
      {expanded && <View style={styles.body}>
        <View style={styles.choices}>{[false, true].map((whole) => <PressableScale key={String(whole)} accessibilityRole="button" accessibilityState={{ selected: wholeSeries === whole }} onPress={() => setWholeSeries(whole)} style={[styles.choice, { backgroundColor: wholeSeries === whole ? c.accentFill : c.glassFill }]}><Text style={{ color: wholeSeries === whole ? c.onAccent : c.textPrimary, fontWeight: '600' }}>{whole ? 'Whole series' : 'Remaining'}</Text></PressableScale>)}</View>
        <Text style={[styles.label, { color: c.textPrimary }]}>Minutes per watch day</Text>
        <View style={styles.choices}>{[30, 60, 90, 120].map((minutes) => <PressableScale key={minutes} accessibilityRole="button" accessibilityState={{ selected: budget === minutes }} onPress={() => setDailyBudget(String(minutes))} style={[styles.choice, { backgroundColor: budget === minutes ? c.accentDim : c.glassFill }]}><Text style={{ color: budget === minutes ? c.accentInk : c.textPrimary }}>{minutes}</Text></PressableScale>)}</View>
        <TextInput accessibilityLabel="Custom minutes per day" accessibilityHint="Enter 1 to 1440 minutes" keyboardType="number-pad" value={dailyBudget} onChangeText={setDailyBudget} maxLength={4} selectTextOnFocus style={[styles.input, { color: c.textPrimary, borderColor: plan ? c.hairline : c.negative, backgroundColor: c.glassFill }]} />
        {!plan && <Text accessibilityRole="alert" style={{ color: c.negative }}>Enter 1–1440 minutes.</Text>}
        <View style={styles.switchRow}><Text style={{ flex: 1, color: c.textPrimary }}>Weekdays only</Text><Switch accessibilityLabel="Watch on weekdays only" value={weekdaysOnly} onValueChange={setWeekdaysOnly} trackColor={{ false: c.trackRing, true: c.accentDim }} thumbColor={weekdaysOnly ? c.accentFill : c.textSecondary} /></View>
        {plan && <View accessibilityLiveRegion="polite" style={[styles.result, { backgroundColor: c.accentDim }]}>
          <Text style={[styles.days, { color: c.accentInk }]}>{plan.watchDays} watch {plan.watchDays === 1 ? 'day' : 'days'}</Text>
          <Text style={{ color: c.textPrimary }}>{workload.episodes ? `Finish around ${plan.finish.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Ready for your next series'}</Text>
          {workload.episodes > 0 && <Text style={[styles.caption, { color: c.textSecondary }]}>About {plan.episodesPerDay.toFixed(1)} episodes per watch day</Text>}
        </View>}
        <Text style={[styles.caption, { color: c.textSecondary }]}>{workload.estimatedEpisodes ? `${workload.estimatedEpisodes} episode runtimes estimated at ${workload.averageRuntime} min. ` : 'Uses known episode runtimes. '}Daily time can span episodes. Announced episodes are included; release dates can extend this plan.</Text>
      </View>}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginBottom: 24 },
  heading: { flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16, minHeight: 72 },
  title: { fontSize: 16, fontWeight: '700' }, caption: { fontSize: 13, lineHeight: 19, marginTop: 4 },
  body: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { paddingHorizontal: 16, paddingVertical: 12, minHeight: 48, borderRadius: 14, justifyContent: 'center' },
  label: { fontSize: 14, fontWeight: '600', marginTop: 8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 16, minHeight: 48 },
  switchRow: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 48 },
  result: { padding: 16, borderRadius: 14, gap: 8 }, days: { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
});
