// client-mobile/components/WatchHeatmap.tsx
// GitHub-style contribution heatmap using react-native-svg.
// 53 columns × 7 rows (Sun–Sat). Color intensity: 0=no activity → 4=max.
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { G, Rect, Text as SvgText } from 'react-native-svg';

import type { HeatmapDay } from '../store/watchStore';
import { useAppTheme } from '../lib/theme';

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

interface WatchHeatmapProps {
  data: HeatmapDay[];
}

export default function WatchHeatmap({ data }: WatchHeatmapProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  const { weeks, monthLabels } = useMemo(() => {
    if (!data || data.length === 0) return { weeks: [], monthLabels: [] };

    // Pad data so it starts on a Sunday
    const firstDate = new Date(data[0].date);
    const startDow = firstDate.getDay(); // 0=Sun
    const paddedData: (HeatmapDay | null)[] = [
      ...Array(startDow).fill(null),
      ...data,
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
  }, [data]);

  const svgWidth = (weeks.length * CELL_STEP) + DAY_LABEL_WIDTH;
  const svgHeight = MONTH_LABEL_HEIGHT + 7 * CELL_STEP;

  const cellFill = (intensity: number) => (intensity === 0 ? c.trackRing : c.accentFill);
  const cellOpacity = (intensity: number) => (intensity === 0 ? 1 : INTENSITY_OPACITY[intensity]);

  return (
    <View style={[styles.container, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <Text style={[styles.sectionLabel, { color: c.textPrimary }]}>Watch Activity</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
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
  sectionLabel: {
    fontSize: 14,
    fontWeight: '700',
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
