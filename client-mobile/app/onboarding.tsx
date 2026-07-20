// client-mobile/app/onboarding.tsx
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { CalendarClock, Check, ListChecks, Trophy } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '../lib/api';
import PressableScale from '../components/PressableScale';
import { useAppTheme } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

interface Slide {
  key: string;
  title: string;
  description: string;
  Icon: typeof ListChecks;
}

const SLIDES: Slide[] = [
  {
    key: 'track',
    title: 'Track every episode',
    description: 'Check off episodes as you watch and watch your progress ring fill in.',
    Icon: ListChecks,
  },
  {
    key: 'countdown',
    title: 'Never miss a drop',
    description: 'See exactly when the next episode of every show on your list airs.',
    Icon: CalendarClock,
  },
  {
    key: 'badges',
    title: 'Earn your badges',
    description: 'Binge streaks, milestone marathons, and genre badges unlock as you go.',
    Icon: Trophy,
  },
];

// Quick-add is its own final page (not in SLIDES — it needs a picker
// layout, not the icon/title/description template the others share).
const TOTAL_PAGES = SLIDES.length + 1;
const PICKER_PAGE_INDEX = SLIDES.length;

interface PickerShow {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const addShowToWatchlist = useWatchStore((state) => state.addShowToWatchlist);
  const scrollRef = useRef<ScrollView>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Quick-add state — user-requested (Phase 19): let a brand-new account
  // leave onboarding with a non-empty watchlist instead of landing on an
  // empty Shows Hub. Entirely optional: Skip/no-selection both proceed
  // with zero shows added, same as before this existed.
  const [popularShows, setPopularShows] = useState<PickerShow[]>([]);
  const [isLoadingPopular, setIsLoadingPopular] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setIsLoadingPopular(true);
    api
      .get('/discover/feed/', { params: { type: 'tv' } })
      .then((res) => {
        if (!isMounted) return;
        const section = (res.data?.sections ?? []).find(
          (s: { id: string }) => s.id === 'popular_shows'
        );
        const items: PickerShow[] = (section?.items ?? res.data?.hero ?? [])
          .slice(0, 12)
          .map((item: { tmdb_id: number; title: string; poster_path: string | null }) => ({
            tmdb_id: item.tmdb_id,
            title: item.title,
            poster_path: item.poster_path,
          }));
        setPopularShows(items);
      })
      .catch(() => {
        // Non-critical — the picker page just renders empty; user can
        // still add shows normally from Discover after onboarding.
      })
      .finally(() => {
        if (isMounted) setIsLoadingPopular(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const toggleSelected = useCallback((tmdbId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tmdbId)) next.delete(tmdbId);
      else next.add(tmdbId);
      return next;
    });
  }, []);

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / SCREEN_WIDTH);
    setActiveIndex(index);
  };

  const handleFinish = useCallback(async () => {
    if (selectedIds.size > 0) {
      setIsFinishing(true);
      await Promise.all(Array.from(selectedIds).map((id) => addShowToWatchlist(id)));
      setIsFinishing(false);
    }
    router.replace('/(tabs)');
  }, [selectedIds, addShowToWatchlist, router]);

  const handleNext = () => {
    if (activeIndex < TOTAL_PAGES - 1) {
      scrollRef.current?.scrollTo({ x: (activeIndex + 1) * SCREEN_WIDTH, animated: true });
    } else {
      handleFinish();
    }
  };

  const isLastPage = activeIndex === TOTAL_PAGES - 1;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <PressableScale style={styles.skipButton} onPress={handleFinish} hitSlop={8}>
        <Text style={[styles.skipText, { color: c.textSecondary }]}>Skip</Text>
      </PressableScale>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleScroll}
      >
        {SLIDES.map(({ key, title, description, Icon }) => (
          <View key={key} style={[styles.slide, { width: SCREEN_WIDTH }]}>
            <View style={[styles.iconCircle, { backgroundColor: c.accentDim, borderColor: c.accentInk }]}>
              <Icon color={c.accentInk} size={40} strokeWidth={1.75} />
            </View>
            <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
            <Text style={[styles.description, { color: c.textSecondary }]}>{description}</Text>
          </View>
        ))}

        {/* Quick-add picker page */}
        <View style={[styles.pickerSlide, { width: SCREEN_WIDTH }]}>
          <Text style={[styles.title, { color: c.textPrimary }]}>Add a few shows</Text>
          <Text style={[styles.description, styles.pickerDescription, { color: c.textSecondary }]}>
            Tap to start tracking. Skip this and add shows anytime from Discover.
          </Text>

          {isLoadingPopular ? (
            <View style={styles.pickerLoading}>
              <ActivityIndicator color={c.accentInk} size="large" />
            </View>
          ) : (
            <View style={styles.pickerGrid}>
              {popularShows.map((show) => {
                const isSelected = selectedIds.has(show.tmdb_id);
                return (
                  <PressableScale
                    key={show.tmdb_id}
                    style={styles.pickerCell}
                    onPress={() => toggleSelected(show.tmdb_id)}
                  >
                    <View style={[styles.pickerPosterWrap, { backgroundColor: c.bgElevated }]}>
                      <Image
                        source={show.poster_path ? { uri: `${POSTER_BASE_URL}${show.poster_path}` } : undefined}
                        style={styles.pickerPoster}
                        contentFit="cover"
                        transition={150}
                      />
                      {isSelected && (
                        <View style={[styles.pickerCheckOverlay, { backgroundColor: 'rgba(0,0,0,0.45)' }]}>
                          <View style={[styles.pickerCheckBadge, { backgroundColor: c.accentFill }]}>
                            <Check color={c.onAccent} size={16} strokeWidth={3} />
                          </View>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.pickerCellTitle, { color: c.textSecondary }]}
                      numberOfLines={1}
                    >
                      {show.title}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {Array.from({ length: TOTAL_PAGES }).map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                { backgroundColor: c.hairline },
                index === activeIndex && [styles.dotActive, { backgroundColor: c.accentInk }],
              ]}
            />
          ))}
        </View>

        <PressableScale
          style={[styles.nextButton, { backgroundColor: c.accentFill }]}
          onPress={handleNext}
          disabled={isFinishing}
        >
          {isFinishing ? (
            <ActivityIndicator color={c.onAccent} size="small" />
          ) : (
            <Text style={[styles.nextButtonText, { color: c.onAccent }]}>
              {isLastPage
                ? selectedIds.size > 0
                  ? `Get Started (${selectedIds.size})`
                  : 'Get Started'
                : 'Next'}
            </Text>
          )}
        </PressableScale>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  skipButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  pickerSlide: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  pickerDescription: {
    marginBottom: 20,
    paddingHorizontal: 16,
  },
  pickerLoading: {
    paddingTop: 40,
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
  },
  pickerCell: {
    width: 84,
    alignItems: 'center',
    gap: 4,
  },
  pickerPosterWrap: {
    width: 84,
    height: 126,
    borderRadius: 10,
    overflow: 'hidden',
  },
  pickerPoster: { width: '100%', height: '100%' },
  pickerCheckOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCellTitle: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 28,
    paddingBottom: 24,
    gap: 20,
  },
  dots: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 20,
  },
  nextButton: {
    borderRadius: 14,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nextButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
