// client-mobile/components/WatchHeatmap.tsx
// GitHub-style contribution heatmap using react-native-svg.
// 53 columns × 7 rows (Sun–Sat). Color intensity: 0=no activity → 4=max.
//
// Phase 74/Group G: "Full history" mode. The `data` prop stays the dense
// 365-day window (unchanged, still the default view); tapping "Full
// history" lazily fetches heatmapAll (?range=all — sparse, year-grouped)
// and switches to a year-chip selector rendering ONE year at a time —
// rendering all years in one non-virtualized <Svg> would mean ~3,640
// <Rect>s for a decade of history. One year is ~371 rects, the same cost
// as the existing dense view.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import type { HeatmapDay, HeatmapYear } from '../store/watchStore';
import { useWatchStore } from '../store/watchStore';
import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;
const MONTH_LABEL_HEIGHT = 14;
const DAY_LABEL_WIDTH = 20;

// Intensity 0 renders as the inert track; 1-4 render as accentFill at
// increasing opacity, preserving the original 0.18/0.40/0.68/1.0 ramp
// without baking a new rgba literal into the token system.
const INTENSITY_OPACITY = [1, 0.18, 0.4, 0.68, 1];

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR = ['','M','','W','','F',''];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// heatmapAll's `days` array is sparse (only days with activity) — the
// week/month-label layout logic below expects a dense day-by-day run, so
// this fills the gaps with zero-activity entries for the selected
// calendar year (Jan 1 → Dec 31, or → today for the current year).
function buildDenseYearDays(year: HeatmapYear): HeatmapDay[] {
  const byDate = new Map(year.days.map((d) => [d.date, d]));
  const start = new Date(Date.UTC(year.year, 0, 1));
  const now = new Date();
  const end = year.year === now.getUTCFullYear() ? now : new Date(Date.UTC(year.year, 11, 31));

  const result: HeatmapDay[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const iso = isoDate(cursor);
    result.push(byDate.get(iso) ?? { date: iso, episodes_watched: 0, minutes_watched: 0, intensity: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

interface WatchHeatmapProps {
  data: HeatmapDay[];
}

export default function WatchHeatmap({ data }: WatchHeatmapProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  const [mode, setMode] = useState<'recent' | 'full'>('recent');
  const [selectedYearIdx, setSelectedYearIdx] = useState(0);
  const heatmapAll = useWatchStore((s) => s.heatmapAll);
  const isLoadingHeatmapAll = useWatchStore((s) => s.isLoadingHeatmapAll);
  const fetchHeatmapAll = useWatchStore((s) => s.fetchHeatmapAll);

  const scrollRef = useRef<ScrollView>(null);
  const hasAutoScrolledRef = useRef(false);

  useEffect(() => {
    // Re-arm the auto-scroll for the newly selected year — without this
    // guard resetting, onContentSizeChange would fight the user's own
    // scrolling on every subsequent layout pass instead of firing once.
    hasAutoScrolledRef.current = false;
  }, [mode, selectedYearIdx]);

  const handleToggleMode = () => {
    if (mode === 'recent') {
      setMode('full');
      setSelectedYearIdx(0);
      if (heatmapAll.length === 0) fetchHeatmapAll();
    } else {
      setMode('recent');
    }
  };

  const selectedYear = mode === 'full' ? heatmapAll[selectedYearIdx] : undefined;
  const effectiveData = selectedYear ? buildDenseYearDays(selectedYear) : data;

  const { weeks, monthLabels } = useMemo(() => {
    if (!effectiveData || effectiveData.length === 0) return { weeks: [], monthLabels: [] };

    // Pad data so it starts on a Sunday
    const firstDate = new Date(effectiveData[0].date);
    const startDow = firstDate.getDay(); // 0=Sun
    const paddedData: (HeatmapDay | null)[] = [
      ...Array(startDow).fill(null),
      ...effectiveData,
    ];

    // Chunk into weeks (columns of 7)
    const weeksArr: (HeatmapDay | null)[][] = [];
    for (let i = 0; i < paddedData.length; i += 7) {
      weeksArr.push(paddedData.slice(i, i + 7));
    }

    // Month labels: place label at first column of each new month
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    weeksArr.forEach((week, colIdx) => {
      for (const day of week) {
        if (day) {
          const m = new Date(day.date).getMonth();
          if (m !== lastMonth) {
            labels.push({ col: colIdx, label: MONTH_ABBR[m] });
            lastMonth = m;
          }
          break;
        }
      }
    });

    return { weeks: weeksArr, monthLabels: labels };
  }, [effectiveData]);

  const svgWidth = (weeks.length * CELL_STEP) + DAY_LABEL_WIDTH;
  const svgHeight = MONTH_LABEL_HEIGHT + 7 * CELL_STEP;

  const cellFill = (intensity: number) => (intensity === 0 ? c.trackRing : c.accentFill);
  const cellOpacity = (intensity: number) => (intensity === 0 ? 1 : INTENSITY_OPACITY[intensity]);

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.sectionLabel, { color: c.textPrimary }]}>Watch Activity</Text>
        <PressableScale onPress={handleToggleMode} hitSlop={6}>
          <Text style={[styles.toggleLink, { color: c.accentInk }]}>
            {mode === 'recent' ? 'Full history' : 'Recent'}
          </Text>
        </PressableScale>
      </View>

      {mode === 'full' && heatmapAll.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearChipRow}>
          {heatmapAll.map((y, idx) => {
            const isActive = idx === selectedYearIdx;
            return (
              <PressableScale
                key={y.year}
                onPress={() => setSelectedYearIdx(idx)}
                style={[
                  styles.yearChip,
                  { borderColor: c.hairline },
                  isActive && { backgroundColor: c.accentFill, borderColor: c.accentFill },
                ]}
              >
                <Text style={[styles.yearChipText, { color: isActive ? c.onAccent : c.textSecondary }]}>
                  {y.year}
                </Text>
              </PressableScale>
            );
          })}
        </ScrollView>
      )}

      {mode === 'full' && isLoadingHeatmapAll && heatmapAll.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={c.accentInk} size="small" />
        </View>
      ) : mode === 'full' && heatmapAll.length === 0 ? (
        <Text style={[styles.emptyText, { color: c.textTertiary }]}>No history yet.</Text>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            onContentSizeChange={() => {
              if (mode === 'full' && !hasAutoScrolledRef.current) {
                hasAutoScrolledRef.current = true;
                scrollRef.current?.scrollToEnd({ animated: false });
              }
            }}
          >
            <Svg width={svgWidth} height={svgHeight}>
              {/* Month labels */}
              {monthLabels.map(({ col, label }) => (
                <SvgText
                  key={`ml-${col}`}
                  x={DAY_LABEL_WIDTH + col * CELL_STEP}
                  y={10}
                  fontSize={9}
                  fill={c.textTertiary}
                  fontWeight="600"
                >
                  {label}
                </SvgText>
              ))}

              {/* Day-of-week labels (M/W/F) */}
              {DAY_ABBR.map((lbl, row) =>
                lbl ? (
                  <SvgText
                    key={`dow-${row}`}
                    x={0}
                    y={MONTH_LABEL_HEIGHT + row * CELL_STEP + CELL_SIZE - 2}
                    fontSize={8}
                    fill={c.textTertiary}
                  >
                    {lbl}
                  </SvgText>
                ) : null
              )}

              {/* Cells */}
              {weeks.map((week, colIdx) => (
                <G key={`col-${colIdx}`} x={DAY_LABEL_WIDTH + colIdx * CELL_STEP} y={MONTH_LABEL_HEIGHT}>
                  {week.map((day, rowIdx) => (
                    <Rect
                      key={`cell-${colIdx}-${rowIdx}`}
                      x={0}
                      y={rowIdx * CELL_STEP}
                      width={CELL_SIZE}
                      height={CELL_SIZE}
                      rx={2}
                      ry={2}
                      fill={day ? cellFill(day.intensity) : cellFill(0)}
                      fillOpacity={day ? cellOpacity(day.intensity) : cellOpacity(0)}
                    />
                  ))}
                </G>
              ))}
            </Svg>
          </ScrollView>

          {selectedYear && (
            <View style={styles.summaryStrip}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>{selectedYear.episodes_watched}</Text>
                <Text style={[styles.summaryLabel, { color: c.textTertiary }]}>Episodes</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>
                  {Math.round(selectedYear.minutes_watched / 60)}
                </Text>
                <Text style={[styles.summaryLabel, { color: c.textTertiary }]}>Hours</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>{selectedYear.days_active}</Text>
                <Text style={[styles.summaryLabel, { color: c.textTertiary }]}>Active days</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, { color: c.accentInk }]}>{selectedYear.max_episodes_in_a_day}</Text>
                <Text style={[styles.summaryLabel, { color: c.textTertiary }]}>Best day</Text>
              </View>
            </View>
          )}
        </>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        <Text style={[styles.legendLabel, { color: c.textTertiary }]}>Less</Text>
        {INTENSITY_OPACITY.map((opacity, i) => (
          <View
            key={i}
            style={[
              styles.legendCell,
              { backgroundColor: i === 0 ? c.trackRing : c.accentFill, opacity: i === 0 ? 1 : opacity },
            ]}
          />
        ))}
        <Text style={[styles.legendLabel, { color: c.textTertiary }]}>More</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  toggleLink: {
    fontSize: 12,
    fontWeight: '700',
  },
  yearChipRow: {
    gap: 8,
  },
  yearChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  yearChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  loadingRow: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 16,
  },
  summaryStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  summaryItem: {
    alignItems: 'center',
    gap: 2,
  },
  summaryValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
  },
  legendCell: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  legendLabel: {
    fontSize: 9,
    fontWeight: '600',
  },
});
