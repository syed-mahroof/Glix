// client-mobile/components/DiscoverFilterSheet.tsx
// Reanimated-based bottom sheet for Discover Hub filtering.
// No external bottom-sheet library needed — pure Reanimated + GestureHandler.

import { LinearGradient } from 'expo-linear-gradient';
import { Flame, Star, Trophy, X, type LucideIcon } from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import PressableScale from './PressableScale';
import {
  ActiveSegment,
  SortOrder,
  useDiscoverStore,
} from '../store/discoverStore';
import { MOVIE_GENRES, TV_GENRES } from '../lib/genres';
import { useAppTheme } from '../lib/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.72;

// ─── Sub-components ────────────────────────────────────────────────────────────

function SortPill({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[
        styles.pill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { backgroundColor: c.accentFill, borderColor: c.accentFill },
      ]}
      onPress={onPress}
    >
      <Icon color={active ? c.onAccent : c.textSecondary} size={14} strokeWidth={2.25} />
      <Text style={[styles.pillText, { color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

function GenrePill({
  name,
  color,
  active,
  onPress,
}: {
  name: string;
  color: string;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[
        styles.genrePill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { borderColor: color, backgroundColor: `${color}22` },
      ]}
      onPress={onPress}
    >
      {active && (
        <View style={[styles.genreDot, { backgroundColor: color }]} />
      )}
      <Text
        style={[styles.genrePillText, { color: c.textSecondary }, active && { color: color }]}
        numberOfLines={1}
      >
        {name}
      </Text>
    </PressableScale>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

interface Props {
  activeSegment: ActiveSegment;
}

export default function DiscoverFilterSheet({ activeSegment }: Props) {
  const {
    filterSheetVisible,
    selectedGenreId,
    sortOrder,
    closeFilterSheet,
    setSelectedGenreId,
    setSortOrder,
    resetFilters,
  } = useDiscoverStore();
  const { theme } = useAppTheme();
  const c = theme.colors;

  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (filterSheetVisible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      backdropOpacity.value = withSpring(1, { damping: 20 });
    } else {
      translateY.value = withSpring(SHEET_HEIGHT, { damping: 22, stiffness: 250 });
      backdropOpacity.value = withSpring(0, { damping: 22 });
    }
  }, [filterSheetVisible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0 ? 'auto' : 'none',
  }));

  const genres = activeSegment === 'tv' ? TV_GENRES : MOVIE_GENRES;

  // Real lucide icons, not emoji — matches the fix already made to the
  // Shows/Movies segment toggle above this sheet ("read as amateurish next
  // to the rest of the app's icon language"); this sheet had the same
  // issue and was missed in that earlier pass.
  const SORT_OPTIONS: { key: SortOrder; label: string; Icon: LucideIcon }[] = [
    { key: 'trending', label: 'Trending', Icon: Flame },
    { key: 'popular', label: 'Popular', Icon: Star },
    { key: 'top_rated', label: 'Top Rated', Icon: Trophy },
  ];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeFilterSheet} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[styles.sheet, { backgroundColor: c.glassFill, borderColor: c.hairline }, sheetStyle]}
      >
        {/* Handle */}
        <View style={[styles.handle, { backgroundColor: c.hairline }]} />

        {/* Header */}
        <View style={[styles.sheetHeader, { borderBottomColor: c.hairline }]}>
          <Text style={[styles.sheetTitle, { color: c.textPrimary }]}>Filter & Sort</Text>
          <PressableScale
            onPress={closeFilterSheet}
            style={[styles.closeBtn, { backgroundColor: c.glassFill }]}
            hitSlop={12}
          >
            <X color={c.textSecondary} size={20} strokeWidth={2} />
          </PressableScale>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Sort By */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Sort By</Text>
          <View style={styles.pillRow}>
            {SORT_OPTIONS.map((opt) => (
              <SortPill
                key={opt.key}
                label={opt.label}
                Icon={opt.Icon}
                active={sortOrder === opt.key}
                onPress={() => setSortOrder(opt.key)}
              />
            ))}
          </View>

          {/* Genres */}
          <Text style={[styles.sectionLabel, { color: c.textSecondary, marginTop: 28 }]}>
            Browse by Genre
          </Text>
          <View style={styles.genreGrid}>
            {genres.map((genre) => (
              <GenrePill
                key={genre.id}
                name={genre.name}
                color={genre.color}
                active={selectedGenreId === genre.id}
                onPress={() =>
                  setSelectedGenreId(
                    selectedGenreId === genre.id ? null : genre.id
                  )
                }
              />
            ))}
          </View>

          {/* Reset */}
          {(selectedGenreId || sortOrder !== 'trending') && (
            <PressableScale
              style={[styles.resetBtn, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
              onPress={resetFilters}
            >
              <Text style={[styles.resetText, { color: c.textSecondary }]}>Reset Filters</Text>
            </PressableScale>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  genreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  genrePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  genreDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  genrePillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  resetBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  resetText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
