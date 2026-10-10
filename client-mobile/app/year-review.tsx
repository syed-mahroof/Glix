import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Calendar, Film, Flame, Share2, Star, Trophy, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { captureRef, releaseCapture } from 'react-native-view-shot';

import AmbientGlow from '../components/AmbientGlow';
import ErrorState from '../components/ErrorState';
import PressableScale from '../components/PressableScale';
import { SegmentedControl } from '../components/SegmentedControl';
import Snackbar from '../components/Snackbar';
import YearReviewCard from '../components/YearReviewCard';
import { extractErrorMessage } from '../lib/errors';
import { staggerEntering, usePrefersReducedMotion } from '../lib/motion';
import { useScreenActive } from '../lib/useScreenActive';
import { useAppTheme } from '../lib/theme';
import { useWatchStore, type YearReviewTitle } from '../store/watchStore';

const CURRENT_YEAR = new Date().getFullYear();
const TMDB_IMAGE = 'https://image.tmdb.org/t/p/w185';
const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const countLabel = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : /(?:s|x|z|ch|sh)$/.test(noun) ? 'es' : 's'}`;

export default function YearReviewScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const reduceMotion = usePrefersReducedMotion();
  const screenActive = useScreenActive();
  const fetchYearReview = useWatchStore((s) => s.fetchYearReview);
  const storedReview = useWatchStore((s) => s.yearReview);
  const isLoading = useWatchStore((s) => s.isLoadingYearReview);
  const error = useWatchStore((s) => s.yearReviewError);
  const dirtyAt = useWatchStore((s) => s.analyticsDirtyAt);
  const [year, setYear] = useState(CURRENT_YEAR);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [library, setLibrary] = useState<'tv' | 'movie' | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareCardRef = useRef<View>(null);
  const lastFetch = useRef<{ year: number; at: number } | null>(null);
  const review = storedReview?.year === year ? storedReview : null;
  const years = useMemo(() => [...new Set([CURRENT_YEAR, ...(storedReview?.available_years ?? []), year])].sort((a, b) => b - a), [storedReview?.available_years, year]);

  useEffect(() => {
    if (!screenActive) return;
    if (lastFetch.current?.year === year && lastFetch.current.at >= dirtyAt && Date.now() - lastFetch.current.at < 60_000) return;
    lastFetch.current = { year, at: Date.now() };
    void fetchYearReview(year);
  }, [year, dirtyAt, screenActive, fetchYearReview]);

  const handleShare = async () => {
    if (isSharing || !shareCardRef.current || !review || isLoading) return;
    setIsSharing(true);
    let uri: string | undefined;
    try {
      if (!await Sharing.isAvailableAsync()) {
        setShareError('Sharing is not available on this device.');
        return;
      }
      uri = await captureRef(shareCardRef, { format: 'png', quality: 1 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `My ${year} on GLIX` });
    } catch (err) {
      setShareError(extractErrorMessage(err));
    } finally {
      if (uri) releaseCapture(uri);
      setIsSharing(false);
    }
  };

  const openTitle = (item: YearReviewTitle) => {
    setLibrary(null);
    router.push(item.media_type === 'movie' ? `/movie/${item.tmdb_id}` : `/show/${item.tmdb_id}`);
  };
  const titleRow = (item: YearReviewTitle, rank: number) => (
    <PressableScale key={`${item.media_type}-${item.tmdb_id}`} onPress={() => openTitle(item)}
      accessibilityRole="button" accessibilityLabel={`View ${item.title}`} style={styles.titleRow}>
      <Text style={[styles.rank, { color: c.accentInk }]}>{rank + 1}</Text>
      {item.poster_path ? <Image source={{ uri: `${TMDB_IMAGE}${item.poster_path}` }} style={styles.poster} contentFit="cover" cachePolicy="memory-disk" recyclingKey={`${item.media_type}-${item.tmdb_id}`} />
        : <View style={[styles.poster, { backgroundColor: c.trackRing }]} />}
      <View style={styles.titleMeta}>
        <Text style={[styles.titleName, { color: c.textPrimary }]} numberOfLines={2}>{item.title}</Text>
        <Text style={[styles.detail, { color: c.textSecondary }]}>
          {item.media_type === 'tv' ? `${item.episodes_watched} episodes` : `${item.watches} ${item.watches === 1 ? 'watch' : 'watches'}`} · {Math.round(item.minutes_watched / 60 * 10) / 10}h
          {item.rating !== null ? ` · ★ ${item.rating}/5` : ''}
        </Text>
        {library !== null && <Text style={[styles.detail, { color: c.textTertiary }]}>
          {shortDate(item.first_watched)} – {shortDate(item.last_watched)}{item.rewatches ? ` · ${item.rewatches} repeats` : ''}
        </Text>}
      </View>
    </PressableScale>
  );
  const selectedMonth = review?.months?.find((m) => m.month === month);
  const peak = Math.max(1, ...(review?.months ?? []).map((m) => m.series_minutes + m.movie_minutes));
  const hasActivity = !!review && (review.episodes_watched + (review.movies_watched ?? 0) > 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isLoading && !!review} onRefresh={() => { lastFetch.current = { year, at: Date.now() }; void fetchYearReview(year); }} tintColor={c.accentInk} />}>
        <View style={styles.header}>
          <PressableScale style={styles.iconButton} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back"><ArrowLeft color={c.textPrimary} size={22} /></PressableScale>
          <View style={styles.center}><Text style={[styles.heading, { color: c.textPrimary }]}>{year} in Review</Text><Text style={[styles.detail, { color: c.textSecondary }]}>{year === CURRENT_YEAR ? 'Your year so far' : 'Your viewing year'}</Text></View>
          <PressableScale style={styles.iconButton} onPress={handleShare} disabled={!hasActivity || isLoading || isSharing} accessibilityRole="button" accessibilityLabel="Share your year in review">
            {isSharing ? <ActivityIndicator color={c.accentInk} /> : <Share2 color={hasActivity ? c.textPrimary : c.textTertiary} size={22} />}
          </PressableScale>
        </View>
        {years.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearOptions}>
          {years.map((value) => <PressableScale key={value} accessibilityRole="tab" accessibilityState={{ selected: value === year }} accessibilityLabel={`Review ${value}`}
            style={[styles.yearPill, { backgroundColor: value === year ? c.accentFill : c.glassFill }]} onPress={() => setYear(value)}>
            <Text style={[styles.pillText, { color: value === year ? c.onAccent : c.textSecondary }]}>{value}</Text>
          </PressableScale>)}
        </ScrollView>}
        {error && <ErrorState message={error} onRetry={() => fetchYearReview(year)} />}
        {isLoading && !review ? <View style={styles.empty}><ActivityIndicator size="large" color={c.accentInk} /><Text style={{ color: c.textSecondary }}>Putting your year together…</Text></View>
          : !hasActivity ? <View style={styles.empty}><Film color={c.accentInk} size={40} /><Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Your story starts with a watch</Text><Text style={[styles.detail, { color: c.textSecondary }]}>No movies or episodes logged in {year} yet.</Text></View>
          : review && <>
            <View ref={shareCardRef} collapsable={false} style={[styles.hero, { backgroundColor: c.bg, borderColor: c.accentDim }]}>
              <AmbientGlow size={240} />
              <Text style={[styles.brand, { color: c.accentInk }]}>GLIX · {year}</Text>
              <Text style={[styles.heroLabel, { color: c.textSecondary }]}>{review.is_year_to_date ? 'MY YEAR SO FAR' : 'MY YEAR IN WATCHES'}</Text>
              <Text style={[styles.heroValue, { color: c.accentInk }]} adjustsFontSizeToFit numberOfLines={1}>{review.hours_watched}h</Text>
              <Text style={[styles.heroSub, { color: c.textPrimary }]}>{countLabel(review.episodes_watched, 'episode')} · {countLabel(review.movies_watched ?? 0, 'movie watch')}</Text>
              <View style={[styles.split, { borderColor: c.hairline }]}>
                <View style={styles.center}><Text style={[styles.splitValue, { color: c.textPrimary }]}>{review.series_hours ?? review.hours_watched}h</Text><Text style={[styles.detail, { color: c.textSecondary }]}>Series</Text></View>
                <View style={styles.center}><Text style={[styles.splitValue, { color: c.textPrimary }]}>{review.movie_hours ?? 0}h</Text><Text style={[styles.detail, { color: c.textSecondary }]}>Movies</Text></View>
              </View>
              <Text style={[styles.detail, { color: c.textSecondary }]}>{countLabel(review.unique_shows ?? review.top_shows.length, 'show')} · {countLabel(review.unique_movies ?? 0, 'film')} · {countLabel(review.active_days ?? 0, 'active day')}</Text>
              {review.most_watched_show && <Text style={[styles.highlight, { color: c.textPrimary }]} numberOfLines={2}>Most watched: {review.most_watched_show.title}</Text>}
              {!!review.top_movies?.length && <Text style={[styles.detail, { color: c.textPrimary }]} numberOfLines={2}>{review.top_movies[0].rating != null ? 'Highest rated film' : 'Movie highlight'}: {review.top_movies[0].title}</Text>}
              {review.favorite_genre && <Text style={[styles.detail, { color: c.accentInk }]}>Your genre: {review.favorite_genre}</Text>}
            </View>
            <Text style={[styles.note, { color: c.textTertiary }]}>Based on logged watch dates. Time includes rewatches and known runtimes.{review.unknown_runtime_watches ? ` ${review.unknown_runtime_watches} watches have no runtime yet.` : ''}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyCards}>
              {[
                { label: 'New to your diary', value: countLabel(review.first_watch_movies ?? 0, 'film'), sublabel: countLabel(review.first_watch_episodes ?? review.episodes_watched, 'first-watch episode'), Icon: Film },
                { label: 'Worth watching again', value: `${(review.episode_rewatches ?? 0) + (review.movie_rewatches ?? 0)} repeats`, sublabel: `${review.episode_rewatches ?? 0} episodes · ${review.movie_rewatches ?? 0} films`, Icon: Star },
                { label: 'Your longest streak', value: countLabel(review.longest_streak, 'day'), sublabel: `Within ${year} · movies and series`, Icon: Flame },
                { label: 'Shows finished', value: String(review.shows_finished), sublabel: `Finalised series completed in ${year}`, Icon: Trophy },
                { label: 'Your busiest month', value: review.biggest_month ?? '—', sublabel: review.biggest_week ?? undefined, Icon: Calendar },
              ].map((card, index) => <Animated.View key={card.label} entering={reduceMotion ? undefined : staggerEntering(index)}><YearReviewCard {...card} /></Animated.View>)}
            </ScrollView>
            <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Your watching rhythm</Text>
              <Text style={[styles.body, { color: c.textSecondary }]}>{review.minutes_per_active_day ?? 0} minutes per active day{review.favorite_weekday ? ` · ${review.favorite_weekday} was your most active day of the week.` : ''}</Text>
              {review.busiest_day && <Text style={[styles.body, { color: c.textPrimary }]}>Biggest watch day: {shortDate(review.busiest_day.date)} · {review.busiest_day.watches} watches</Text>}
              {review.favorite_actor && <Text style={[styles.body, { color: c.textPrimary }]}>Your MVP character: {review.favorite_actor}</Text>}
              {review.average_rating != null && <Text style={[styles.body, { color: c.textPrimary }]}>Your average rating: ★ {review.average_rating}/5 across {review.rated_titles} titles</Text>}
            </View>
            {!!review.months?.length && <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>The chapters of your year</Text>
              <Text style={[styles.detail, { color: c.textSecondary }]}>Series in accent · Movies in grey · Tap a month</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chart}>
                {review.months.map((m) => <PressableScale key={m.month} style={[styles.monthColumn, { borderColor: month === m.month ? c.accentInk : 'transparent' }]}
                  accessibilityRole="button" accessibilityState={{ selected: month === m.month }} accessibilityLabel={`${m.label}: ${m.episodes} episodes, ${m.movies} movie watches`} onPress={() => setMonth(m.month)}>
                  <View style={styles.barSpace}><View style={{ width: 20, height: 88 * m.movie_minutes / peak, backgroundColor: c.textSecondary, borderTopLeftRadius: 4, borderTopRightRadius: 4 }} /><View style={{ width: 20, height: 88 * m.series_minutes / peak, backgroundColor: c.accentInk }} /></View>
                  <Text style={[styles.detail, { color: c.textSecondary }]}>{m.label.slice(0, 3)}</Text>
                </PressableScale>)}
              </ScrollView>
              {selectedMonth && <View style={styles.monthDetail}>
                <Text style={[styles.titleName, { color: c.textPrimary }]}>{selectedMonth.label} · {Math.round((selectedMonth.series_minutes + selectedMonth.movie_minutes) / 60 * 10) / 10}h</Text>
                <Text style={[styles.body, { color: c.textSecondary }]}>{selectedMonth.episodes} episodes · {selectedMonth.movies} movie watches · {selectedMonth.rewatches} repeats</Text>
                {selectedMonth.top_show && <Text style={[styles.body, { color: c.textPrimary }]}>Series highlight: {selectedMonth.top_show.title}</Text>}
                {selectedMonth.top_movie && <Text style={[styles.body, { color: c.textPrimary }]}>Movie highlight: {selectedMonth.top_movie.title}</Text>}
              </View>}
            </View>}
            {([['tv', 'The series that stayed with you', review.watched_shows], ['movie', 'Your movie highlights', review.watched_movies]] as const).map(([kind, title, items]) => !!items?.length &&
              <View key={kind} style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>{title}</Text>
                <Text style={[styles.detail, { color: c.textSecondary }]}>{kind === 'tv' ? 'Ranked by time watched' : 'Your ratings first, then repeat watches'}</Text>
                {items.slice(0, 5).map(titleRow)}
                <PressableScale onPress={() => setLibrary(kind)} style={[styles.libraryButton, { borderColor: c.hairline }]} accessibilityRole="button"><Text style={[styles.pillText, { color: c.accentInk }]}>See all {kind === 'tv' ? 'shows' : 'movies'} · {items.length}</Text></PressableScale>
              </View>)}
            {!!review.top_genres.length && <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Your taste this year</Text>
              {review.top_genres.map((g) => <View key={g.genre} style={styles.genreRow}><Text style={[styles.body, { color: c.textPrimary }]}>{g.genre}</Text><Text style={[styles.detail, { color: c.textSecondary }]}>{g.count} watches</Text></View>)}
              <Text style={[styles.note, { color: c.textTertiary }]}>A watch can belong to several genres. Ratings shown are your current personal ratings.</Text>
            </View>}
          </>}
      </ScrollView>
      <Modal visible={library !== null} animationType={reduceMotion ? 'none' : 'slide'} onRequestClose={() => setLibrary(null)}>
        <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
          <View style={[styles.header, styles.modalHeader]}><Text style={[styles.heading, { color: c.textPrimary }]}>{year} · Your library</Text><PressableScale style={styles.iconButton} onPress={() => setLibrary(null)} accessibilityRole="button" accessibilityLabel="Close library"><X size={22} color={c.textPrimary} /></PressableScale></View>
          <View style={styles.modalHeader}><SegmentedControl segments={[{ value: 'tv', label: 'Shows' }, { value: 'movie', label: 'Movies' }]} selectedValue={library ?? 'tv'} onValueChange={setLibrary} /></View>
          <FlashList data={library === 'movie' ? review?.watched_movies ?? [] : review?.watched_shows ?? []} keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`} renderItem={({ item, index }) => titleRow(item, index)} contentContainerStyle={styles.libraryContent} ListEmptyComponent={<Text style={[styles.note, { color: c.textSecondary }]}>No watches logged in this category this year.</Text>} />
        </SafeAreaView>
      </Modal>
      <Snackbar visible={!!shareError} message={shareError ?? ''} onDismiss={() => setShareError(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, content: { paddingHorizontal: 20, paddingBottom: 48, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  iconButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 4 }, heading: { fontSize: 18, fontWeight: '800', letterSpacing: -0.4 },
  detail: { fontSize: 12, lineHeight: 18 }, body: { fontSize: 14, lineHeight: 22 }, note: { fontSize: 11, lineHeight: 17 },
  empty: { alignItems: 'center', paddingVertical: 72, gap: 16 }, yearOptions: { gap: 8 },
  yearPill: { minHeight: 48, paddingHorizontal: 20, borderRadius: 24, justifyContent: 'center' }, pillText: { fontSize: 13, fontWeight: '700' },
  hero: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, padding: 24, alignItems: 'center', gap: 8, overflow: 'hidden' },
  brand: { fontSize: 13, fontWeight: '900', letterSpacing: 3 }, heroLabel: { fontSize: 11, letterSpacing: 1.8, fontWeight: '600', marginTop: 12 },
  heroValue: { fontSize: 76, fontWeight: '900', letterSpacing: -3, lineHeight: 90 }, heroSub: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  split: { width: '100%', flexDirection: 'row', justifyContent: 'space-evenly', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16, marginTop: 8 },
  splitValue: { fontSize: 24, fontWeight: '800' }, highlight: { fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  storyCards: { gap: 8 }, card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 16, gap: 12 }, sectionTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 76, paddingVertical: 8 }, rank: { fontSize: 15, fontWeight: '800', width: 22, textAlign: 'center' },
  poster: { width: 40, height: 60, borderRadius: 6 }, titleMeta: { flex: 1, gap: 3 }, titleName: { fontSize: 14, fontWeight: '700' },
  libraryButton: { minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, justifyContent: 'center', alignItems: 'center' }, genreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  chart: { gap: 4 }, monthColumn: { minWidth: 48, paddingVertical: 6, alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 8 }, barSpace: { height: 88, justifyContent: 'flex-end' },
  monthDetail: { gap: 6 }, modalHeader: { marginHorizontal: 20, marginBottom: 16 }, libraryContent: { paddingHorizontal: 20, paddingBottom: 32 },
});
