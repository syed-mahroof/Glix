// client-mobile/components/CalendarGrid.tsx
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { buildMonthGrid, pad, todayLocalIso } from '../lib/dateFormat';
import { useAppTheme } from '../lib/theme';
import type { UpcomingItem } from '../lib/upcoming';
import PressableScale from './PressableScale';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

interface CalendarGridProps {
  items: UpcomingItem[];
}

export default function CalendarGrid({ items }: CalendarGridProps) {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [currentDate, setCurrentDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedIsoDate, setSelectedIsoDate] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
    setSelectedIsoDate(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
    setSelectedIsoDate(null);
  };

  const monthGrid = useMemo(() => buildMonthGrid(year, month), [year, month]);

  // Group items by their airDate (YYYY-MM-DD)
  const itemsByDate = useMemo(() => {
    const map = new Map<string, UpcomingItem[]>();
    for (const item of items) {
      if (!map.has(item.airDate)) {
        map.set(item.airDate, []);
      }
      map.get(item.airDate)!.push(item);
    }
    return map;
  }, [items]);

  const selectedItems = selectedIsoDate ? itemsByDate.get(selectedIsoDate) ?? [] : [];

  const monthLabel = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <PressableScale
          onPress={handlePrevMonth}
          hitSlop={10}
          style={[styles.navButton, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
        >
          <ChevronLeft color={c.textPrimary} size={24} />
        </PressableScale>
        <Text style={[styles.monthLabel, { color: c.accentInk }]}>{monthLabel}</Text>
        <PressableScale
          onPress={handleNextMonth}
          hitSlop={10}
          style={[styles.navButton, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
        >
          <ChevronRight color={c.textPrimary} size={24} />
        </PressableScale>
      </View>

      <View style={styles.weekdayRow}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <Text key={day} style={[styles.weekdayLabel, { color: c.textTertiary }]}>
            {day}
          </Text>
        ))}
      </View>

      <View style={[styles.grid, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
        {monthGrid.map((week, weekIdx) => (
          <View key={weekIdx} style={styles.weekRow}>
            {week.map((date, dayIdx) => {
              const isoDate = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
              const hasEpisodes = itemsByDate.has(isoDate);
              const isCurrentMonth = date.getMonth() === month;
              const isSelected = selectedIsoDate === isoDate;

              const isToday = todayLocalIso() === isoDate;

              return (
                <PressableScale
                  key={dayIdx}
                  style={[
                    styles.dayCell,
                    { borderColor: c.hairline },
                    !isCurrentMonth && { backgroundColor: 'rgba(0,0,0,0.2)' },
                    isToday && !isSelected && { backgroundColor: c.accentDim },
                    isSelected && { backgroundColor: c.accentDim, borderColor: c.accentInk },
                  ]}
                  onPress={() => hasEpisodes && setSelectedIsoDate(isoDate)}
                  disabled={!hasEpisodes && !isSelected} // Only allow tapping if there are episodes to see, or deselecting
                >
                  <Text
                    style={[
                      styles.dayText,
                      { color: c.textPrimary },
                      !isCurrentMonth && { color: c.textTertiary },
                      isSelected && { color: c.accentInk, fontWeight: '700' },
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  {hasEpisodes && (
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: c.accentInk },
                        isSelected && { backgroundColor: c.textPrimary },
                      ]}
                    />
                  )}
                </PressableScale>
              );
            })}
          </View>
        ))}
      </View>

      {selectedIsoDate && (
        <View style={styles.selectedContainer}>
          <Text style={[styles.selectedDateTitle, { color: c.accentInk }]}>
            Releases on {selectedIsoDate}
          </Text>
          {selectedItems.map((item) => (
            <PressableScale
              key={item.key}
              style={[styles.episodeRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
              onPress={() =>
                router.push({
                  pathname: `/show/${item.tmdbShowId}` as any,
                  params: { title: item.showTitle, poster_path: item.posterPath ?? '' },
                })
              }
            >
              <Image
                source={item.posterPath ? { uri: `${POSTER_BASE_URL}${item.posterPath}` } : undefined}
                style={[styles.poster, { backgroundColor: c.bgElevated }]}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.textColumn}>
                <Text style={[styles.showTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {item.showTitle}
                </Text>
                <Text style={[styles.episodeTitle, { color: c.textSecondary }]} numberOfLines={1}>
                  S{pad(item.seasonNumber)}E{pad(item.episodeNumber)} · {item.episodeTitle}
                </Text>
              </View>
            </PressableScale>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '700',
  },
  navButton: {
    padding: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  grid: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    overflow: 'hidden',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  dayText: {
    fontSize: 15,
    fontWeight: '600',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    position: 'absolute',
    bottom: 6,
  },
  selectedContainer: {
    marginTop: 8,
    gap: 12,
  },
  selectedDateTitle: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  episodeRow: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
    alignItems: 'center',
  },
  poster: {
    width: 52,
    height: 78,
    borderRadius: 8,
  },
  textColumn: {
    flex: 1,
    gap: 4,
  },
  showTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  episodeTitle: {
    fontSize: 12,
  },
});
