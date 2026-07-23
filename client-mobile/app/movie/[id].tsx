// client-mobile/app/movie/[id].tsx
// Glix V2 — Full Movie Details Screen
// Complete TMDB integration: details, cast, crew, watch providers, recommendations.

import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  BookmarkPlus,
  CheckCircle,
  Clock,
  MessageCircle,
  Star,
  Trash2,
  WifiOff,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CastCard } from '../../components/CastCard';
import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { ProviderBadge } from '../../components/ProviderBadge';
import RatingReviewCard from '../../components/RatingReviewCard';
import Snackbar from '../../components/Snackbar';
import { api } from '../../lib/api';
import { extractErrorMessage } from '../../lib/errors';
import { useAppTheme } from '../../lib/theme';
import { RemovedMovieSnapshot, useWatchStore } from '../../store/watchStore';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const BACKDROP_BASE_URL = 'https://image.tmdb.org/t/p/w1280';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
const REC_POSTER_URL = 'https://image.tmdb.org/t/p/w185';
const PROFILE_BASE_URL = 'https://image.tmdb.org/t/p/w185';

interface MovieDetail {
  tmdb_id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  runtime_minutes: number;
  genres: string[];
  vote_average: number;
}

interface CastMember {
  person_id: number;
  name: string;
  profile_path: string | null;
  character: string;
}

interface CrewMember {
  person_id: number;
  name: string;
  profile_path: string | null;
  job: string;
  department: string;
}

interface ProviderItem {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

interface RecItem {
  tmdb_id: number;
  media_type: string;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  release_date: string | null;
}

function formatRuntime(minutes: number): string {
  if (!minutes) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MovieDetailScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const {
    id,
    title: fallbackTitle,
    poster_path: fallbackPoster,
    vote_average: fallbackVote,
    backdrop_path: fallbackBackdrop,
    overview: fallbackOverview,
  } = useLocalSearchParams<{
    id: string;
    title?: string;
    poster_path?: string;
    vote_average?: string;
    backdrop_path?: string;
    overview?: string;
  }>();

  const tmdbId = Number(id);

  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isTogglingWatch, setIsTogglingWatch] = useState(false);
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeSnapshot, setRemoveSnapshot] = useState<RemovedMovieSnapshot | null>(null);
  const [removeSnackbarVisible, setRemoveSnackbarVisible] = useState(false);
  const [addedSnackbarVisible, setAddedSnackbarVisible] = useState(false);

  const movieWatchlist = useWatchStore((state) => state.movieWatchlist);
  const fetchMovieWatchlist = useWatchStore((state) => state.fetchMovieWatchlist);
  const toggleMovieWatchState = useWatchStore((state) => state.toggleMovieWatchState);
  const addMovieToWatchlist = useWatchStore((state) => state.addMovieToWatchlist);
  const removeMovieFromWatchlist = useWatchStore((state) => state.removeMovieFromWatchlist);
  const undoRemoveMovie = useWatchStore((state) => state.undoRemoveMovie);

  // The watchlist row for this movie (if tracked) lives in the Zustand
  // store — mirrors show/[id].tsx's watchlistEntry derivation so this
  // screen never has its own out-of-sync copy of watched/added state.
  const movieEntry = !Number.isNaN(tmdbId)
    ? [...movieWatchlist.watch_next, ...movieWatchlist.watched].find(
        (item) => item.movie.tmdb_id === tmdbId
      ) ?? null
    : null;
  const isInWatchlist = movieEntry !== null;
  const isWatched = movieEntry?.movie.is_watched ?? false;

  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const headerOpacity = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [160, 220], [0, 1], Extrapolation.CLAMP),
  }));

  const backdropScale = useAnimatedStyle(() => ({
    transform: [
      {
        scale: interpolate(scrollY.value, [-100, 0], [1.15, 1], Extrapolation.CLAMP),
      },
    ],
  }));

  // Optimistic data while main request is in flight
  const displayMovie: MovieDetail | null = movie ?? (fallbackTitle
    ? {
        tmdb_id: tmdbId,
        title: fallbackTitle,
        overview: fallbackOverview ?? '',
        poster_path: fallbackPoster ?? null,
        backdrop_path: fallbackBackdrop ?? null,
        release_date: null,
        runtime_minutes: 0,
        genres: [],
        vote_average: Number(fallbackVote) || 0,
      }
    : null);

  const loadDetails = useCallback(async () => {
    if (Number.isNaN(tmdbId)) {
      setLoadError('Invalid movie ID.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<MovieDetail>(`/movies/${tmdbId}/detail/`);
      setMovie(res.data);
    } catch (err) {
      setLoadError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [tmdbId]);

  const loadSecondary = useCallback(async () => {
    if (Number.isNaN(tmdbId)) return;
    const [creditsRes, providersRes, recsRes] = await Promise.allSettled([
      api.get<{ cast: CastMember[]; crew: CrewMember[] }>(`/movies/${tmdbId}/credits/`),
      api.get<ProviderItem[]>(`/movies/${tmdbId}/watch-providers/`),
      api.get<{ results: RecItem[] }>(`/movies/${tmdbId}/recommendations/`),
    ]);
    if (creditsRes.status === 'fulfilled') {
      setCast(creditsRes.value.data.cast ?? []);
      setCrew(creditsRes.value.data.crew ?? []);
    }
    if (providersRes.status === 'fulfilled') {
      setProviders(providersRes.value.data ?? []);
    }
    if (recsRes.status === 'fulfilled') {
      setRecommendations(recsRes.value.data.results ?? []);
    }
  }, [tmdbId]);

  useEffect(() => {
    loadDetails();
    loadSecondary();
    fetchMovieWatchlist();
  }, [loadDetails, loadSecondary, fetchMovieWatchlist]);

  /** Context-sensitive primary action, mirrors TV Time's Add → Track flow:
   *  not tracked yet → adds to the watchlist in place (Phase I: no forced
   *  navigation — the icon itself already flips to the watched-toggle state
   *  the moment `isInWatchlist` goes true via the store's optimistic
   *  update; a Snackbar covers the confirmation instead of a redirect);
   *  already tracked → toggles watched state in place (store-driven,
   *  optimistic — no local isWatched copy to fall out of sync). */
  const handlePrimaryAction = async () => {
    if (Number.isNaN(tmdbId)) return;

    if (!isInWatchlist) {
      if (isAddingToWatchlist) return;
      setIsAddingToWatchlist(true);
      const success = await addMovieToWatchlist(tmdbId);
      setIsAddingToWatchlist(false);
      if (success) {
        setAddedSnackbarVisible(true);
      }
      return;
    }

    if (isTogglingWatch) return;
    setIsTogglingWatch(true);
    await toggleMovieWatchState(tmdbId);
    setIsTogglingWatch(false);
  };

  /** Full-delete "Remove from Watchlist" (Phase F) — mirrors show/[id].tsx's
   *  handleRemoveFromWatchlist exactly: acts immediately, offers a real
   *  Undo via the server-returned snapshot rather than a deferred commit. */
  const handleRemoveFromWatchlist = async () => {
    if (Number.isNaN(tmdbId) || isRemoving || !isInWatchlist) return;
    setIsRemoving(true);
    const snapshot = await removeMovieFromWatchlist(tmdbId);
    setIsRemoving(false);
    if (snapshot) {
      setRemoveSnapshot(snapshot);
      setRemoveSnackbarVisible(true);
    }
  };

  const handleUndoRemove = async () => {
    setRemoveSnackbarVisible(false);
    if (!removeSnapshot) return;
    const snapshot = removeSnapshot;
    setRemoveSnapshot(null);
    await undoRemoveMovie(snapshot);
  };

  if (isLoading && !displayMovie) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <SafeAreaView style={styles.loadingCenter}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </SafeAreaView>
      </View>
    );
  }

  if (loadError && !displayMovie) {
    return (
      <View style={[styles.container, { backgroundColor: c.bg }]}>
        <SafeAreaView style={{ flex: 1 }}>
          <PressableScale style={[styles.backButton, { backgroundColor: c.glassFill, borderColor: c.hairline, borderWidth: StyleSheet.hairlineWidth }]} onPress={() => router.back()}>
            <ArrowLeft color={c.textPrimary} size={22} />
          </PressableScale>
          <View style={styles.loadingCenter}>
            <GlassSurface radius={18} style={styles.errorCard}>
              <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
              <Text style={[styles.errorText, { color: c.textSecondary }]}>{loadError}</Text>
              <PressableScale style={[styles.retryBtn, { backgroundColor: c.accentDim, borderColor: c.accentInk }]} onPress={loadDetails}>
                <Text style={[styles.retryText, { color: c.accentInk }]}>Retry</Text>
              </PressableScale>
            </GlassSurface>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const d = displayMovie!;
  const year = d.release_date ? new Date(d.release_date).getFullYear() : null;

  return (
    <View style={[styles.container, { backgroundColor: c.bg }]}>
      {/* ── Sticky compact header (fades in on scroll, once the backdrop
          photo has scrolled past — this sits over the app's own blurred
          chrome, not the photo, so it's fully themed unlike the backdrop
          row below). ─────────────────────────────────────────────────── */}
      <Animated.View style={[styles.stickyHeader, headerOpacity]}>
        <BlurView intensity={90} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: c.glassFill }]} />
        <SafeAreaView edges={['top']}>
          <View style={styles.stickyHeaderRow}>
            <PressableScale onPress={() => router.back()} hitSlop={8} style={[styles.iconBtn, { backgroundColor: c.glassFill, borderColor: c.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
              <ArrowLeft color={c.textPrimary} size={20} />
            </PressableScale>
            <Text style={[styles.stickyTitle, { color: c.textPrimary }]} numberOfLines={1}>
              {d.title}
            </Text>
            <View style={{ width: 36 }} />
          </View>
        </SafeAreaView>
      </Animated.View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scrollContent}
      >
        {/* ── Backdrop hero — painted over a photo, so the gradient scrim
            and floating icon buttons stay a fixed dark treatment in both
            themes (same "caption on a photo" precedent as show/[id].tsx). ── */}
        <View style={[styles.backdropWrap, { backgroundColor: c.bgElevated }]}>
          <Animated.View style={[StyleSheet.absoluteFillObject, backdropScale]}>
            <Image
              source={d.backdrop_path ? { uri: `${BACKDROP_BASE_URL}${d.backdrop_path}` } : undefined}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              transition={300}
            />
          </Animated.View>
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.5)', '#000000']}
            locations={[0.3, 0.7, 1]}
            style={StyleSheet.absoluteFillObject}
          />
          {/* back button over backdrop */}
          <SafeAreaView edges={['top']} style={styles.backdropTopRow}>
            <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
              <ArrowLeft color="#FFF" size={22} />
            </PressableScale>
            <View style={styles.backdropActionsRow}>
              {isInWatchlist && (
                <PressableScale
                  onPress={handleRemoveFromWatchlist}
                  disabled={isRemoving}
                  hitSlop={8}
                  style={styles.iconBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Remove from Watchlist"
                >
                  <Trash2 color="#FFF" size={20} />
                </PressableScale>
              )}
              <PressableScale
                onPress={handlePrimaryAction}
                hitSlop={8}
                style={styles.iconBtn}
                accessibilityLabel={
                  !isInWatchlist ? 'Add to Watchlist' : isWatched ? 'Watched' : 'Mark as Watched'
                }
              >
                {isWatched ? (
                  <CheckCircle color={c.accentFill} size={22} />
                ) : (
                  <BookmarkPlus color={isInWatchlist ? c.accentFill : '#FFF'} size={22} />
                )}
              </PressableScale>
            </View>
          </SafeAreaView>
        </View>

        {/* ── Hero metadata row ──────────────────────────────────────── */}
        <View style={styles.heroRow}>
          <Image
            source={d.poster_path ? { uri: `${POSTER_BASE_URL}${d.poster_path}` } : undefined}
            style={[styles.poster, { backgroundColor: c.bgElevated, borderColor: c.bg }]}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.heroMeta}>
            <Text style={[styles.movieTitle, { color: c.textPrimary }]} numberOfLines={3}>{d.title}</Text>
            <View style={styles.metaRow}>
              <Star color={c.accentInk} size={13} fill={c.accentInk} />
              <Text style={[styles.metaText, { color: c.textSecondary }]}>{d.vote_average.toFixed(1)}</Text>
              {year && (
                <>
                  <Text style={[styles.metaDot, { color: c.textTertiary }]}>·</Text>
                  <Text style={[styles.metaText, { color: c.textSecondary }]}>{year}</Text>
                </>
              )}
              {d.runtime_minutes > 0 && (
                <>
                  <Text style={[styles.metaDot, { color: c.textTertiary }]}>·</Text>
                  <Clock color={c.textSecondary} size={12} />
                  <Text style={[styles.metaText, { color: c.textSecondary }]}>{formatRuntime(d.runtime_minutes)}</Text>
                </>
              )}
            </View>

            {/* Genres */}
            {d.genres.length > 0 && (
              <View style={styles.genreRow}>
                {d.genres.slice(0, 3).map((genre) => (
                  <View key={genre} style={[styles.genreChip, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                    <Text style={[styles.genreText, { color: c.textSecondary }]}>{genre}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Add to Watchlist / Mark as Watched / Watched button */}
            <PressableScale
              style={[
                styles.watchBtn,
                { backgroundColor: c.accentDim, borderColor: c.accentInk },
                isWatched && { backgroundColor: c.accentFill, borderColor: c.accentFill },
              ]}
              onPress={handlePrimaryAction}
              disabled={isTogglingWatch || isAddingToWatchlist}
            >
              {isWatched ? (
                <CheckCircle color={c.onAccent} size={15} strokeWidth={2.5} />
              ) : (
                <BookmarkPlus color={c.accentInk} size={15} strokeWidth={2.5} />
              )}
              <Text style={[styles.watchBtnText, { color: c.accentInk }, isWatched && { color: c.onAccent }]}>
                {!isInWatchlist ? 'Add to Watchlist' : isWatched ? 'Watched' : 'Mark as Watched'}
              </Text>
            </PressableScale>
          </View>
        </View>

        {/* ── Your Rating (Phase L) ────────────────────────────────────── */}
        {!Number.isNaN(tmdbId) && (
          <View style={styles.section}>
            <RatingReviewCard mediaType="movie" tmdbId={tmdbId} />
          </View>
        )}

        {/* ── Overview ──────────────────────────────────────────────── */}
        {d.overview ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Overview</Text>
            <Text style={[styles.overview, { color: c.textSecondary }]}>{d.overview}</Text>
          </View>
        ) : null}

        {/* Loading shimmer for secondary data */}
        {isLoading && !movie && (
          <View style={styles.shimmerRow}>
            <ActivityIndicator color={c.textTertiary} size="small" />
            <Text style={[styles.shimmerText, { color: c.textTertiary }]}>Loading details…</Text>
          </View>
        )}

        {/* ── Where to Watch ──────────────────────────────────────────── */}
        {providers.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Where to Watch</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
              {providers.map((p, i) => (
                <ProviderBadge key={`${p.provider_id}-${i}`} providerName={p.provider_name} logoPath={p.logo_path} />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Cast ───────────────────────────────────────────────────── */}
        {cast.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Cast</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
              {cast.map((member) => (
                <CastCard
                  key={member.person_id}
                  name={member.name}
                  role={member.character}
                  profilePath={member.profile_path}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Crew ───────────────────────────────────────────────────── */}
        {crew.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Crew</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
              {crew.map((member, i) => (
                <CastCard
                  key={`${member.person_id}-${i}`}
                  name={member.name}
                  role={member.job}
                  profilePath={member.profile_path}
                  footnote={member.department}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {/* ── Recommendations ──────────────────────────────────────── */}
        {recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>More Like This</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hList}>
              {recommendations.map((item) => (
                <PressableScale
                  key={item.tmdb_id}
                  style={styles.recCard}
                  onPress={() =>
                    router.push({
                      pathname: `/movie/${item.tmdb_id}` as any,
                      params: {
                        title: item.title,
                        poster_path: item.poster_path ?? '',
                        backdrop_path: item.backdrop_path ?? '',
                        overview: item.overview ?? '',
                        vote_average: item.vote_average.toString(),
                      },
                    })
                  }
                >
                  <Image
                    source={item.poster_path ? { uri: `${REC_POSTER_URL}${item.poster_path}` } : undefined}
                    style={[styles.recPoster, { backgroundColor: c.bgElevated }]}
                    contentFit="cover"
                    transition={150}
                  />
                  <Text style={[styles.recTitle, { color: c.textSecondary }]} numberOfLines={2}>{item.title}</Text>
                  {/* Gold rating star — pre-existing non-token color, unrelated to light/dark, left as-is per migration rules. */}
                  <Text style={styles.recRating}>★ {item.vote_average.toFixed(1)}</Text>
                </PressableScale>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={{ height: 60 }} />
      </Animated.ScrollView>

      <Snackbar
        visible={removeSnackbarVisible}
        message="Removed from Watchlist"
        actionLabel="UNDO"
        onAction={handleUndoRemove}
        onDismiss={() => setRemoveSnackbarVisible(false)}
      />

      <Snackbar
        visible={addedSnackbarVisible}
        message="Added to Watchlist"
        onDismiss={() => setAddedSnackbarVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Loading / error states
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  errorCard: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 28,
    paddingVertical: 32,
    width: '100%',
  },
  errorText: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retryText: { fontSize: 14, fontWeight: '700' },

  // Sticky header
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  stickyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  stickyTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 8,
  },

  // Scroll
  scrollContent: { paddingBottom: 48 },

  // Backdrop — photo-caption chrome, stays theme-invariant (see call site).
  backdropWrap: {
    height: 300,
    width: SCREEN_WIDTH,
    overflow: 'hidden',
  },
  backdropTopRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdropActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  backButton: {
    position: 'absolute',
    top: 52,
    left: 20,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },

  // Hero row
  heroRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 20,
    marginTop: -60,
  },
  poster: {
    width: 110,
    height: 165,
    borderRadius: 14,
    borderWidth: 2,
  },
  heroMeta: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: 8,
    paddingBottom: 4,
    paddingTop: 12,
  },
  movieTitle: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metaDot: { fontSize: 12 },
  genreRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  genreChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  genreText: { fontSize: 11, fontWeight: '600' },

  // Watch button
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  watchBtnText: { fontSize: 12, fontWeight: '700' },

  // Sections
  section: { marginTop: 28, gap: 12 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    paddingHorizontal: 20,
  },
  overview: {
    fontSize: 14,
    lineHeight: 22,
    paddingHorizontal: 20,
  },
  hList: { paddingHorizontal: 20, gap: 12 },

  // Loading shimmer
  shimmerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 20,
  },
  shimmerText: { fontSize: 13 },

  // Recommendations
  recCard: { width: 110, gap: 6 },
  recPoster: {
    width: 110,
    height: 165,
    borderRadius: 12,
  },
  recTitle: { fontSize: 11, fontWeight: '600' },
  // Gold rating star — pre-existing non-token color, unrelated to light/dark.
  recRating: { color: '#FFD700', fontSize: 10, fontWeight: '700' },
});
