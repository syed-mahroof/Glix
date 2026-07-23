// client-mobile/app/show/[id].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  ArrowLeft,
  Archive,
  ArchiveRestore,
  CheckCircle,
  Heart,
  MessageCircle,
  Plus,
  Star,
  Trash2,
  WifiOff,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CascadeModal from '../../components/CascadeModal';
import { CastCard } from '../../components/CastCard';
import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { ProgressRing } from '../../components/ProgressRing';
import { ProviderBadge } from '../../components/ProviderBadge';
import RatingReviewCard from '../../components/RatingReviewCard';
import { SeasonCard } from '../../components/SeasonCard';
import Snackbar from '../../components/Snackbar';
import { api } from '../../lib/api';
import { todayLocalIso } from '../../lib/dateFormat';
import { extractErrorMessage } from '../../lib/errors';
import { goBack } from '../../lib/navigation';
import { useAppTheme } from '../../lib/theme';
import { useCatchupCascade } from '../../lib/useCatchupCascade';
import { Episode, RemovedShowSnapshot, Show, useWatchStore } from '../../store/watchStore';

const BACKDROP_BASE_URL = 'https://image.tmdb.org/t/p/w780';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w342';
const REC_POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

interface CastMember {
  person_id: number;
  name: string;
  profile_path: string | null;
  character: string;
  episode_count: number;
}

interface CrewMember {
  person_id: number;
  name: string;
  profile_path: string | null;
  job: string;
  department: string;
  episode_count: number;
}

interface RecommendationItem {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  vote_average: number;
  first_air_date: string | null;
}

interface ProviderItem {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

const STATUS_LABEL: Record<Show['status'], string> = {
  RETURNING: 'Returning Series',
  ENDED: 'Ended',
  CANCELED: 'Canceled',
  IN_PRODUCTION: 'In Production',
};

export default function ShowDetailScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { id, title: fallbackTitle, poster_path: fallbackPoster, vote_average: fallbackVote, backdrop_path: fallbackBackdrop, overview: fallbackOverview } = useLocalSearchParams<{ id: string, title?: string, poster_path?: string, vote_average?: string, backdrop_path?: string, overview?: string }>();
  const tmdbId = Number(id);

  const watchlist = useWatchStore((state) => state.watchlist);
  const fetchWatchlist = useWatchStore((state) => state.fetchWatchlist);
  const fetchProfile = useWatchStore((state) => state.fetchProfile);
  const addShowToWatchlist = useWatchStore((state) => state.addShowToWatchlist);
  const bulkToggleWatchState = useWatchStore((state) => state.bulkToggleWatchState);
  const removeShowFromWatchlist = useWatchStore((state) => state.removeShowFromWatchlist);
  const undoRemoveShow = useWatchStore((state) => state.undoRemoveShow);

  const [show, setShow] = useState<Show | null>(null);
  const [cast, setCast] = useState<CastMember[]>([]);
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [providers, setProviders] = useState<ProviderItem[]>([]);

  const [isLoadingShow, setIsLoadingShow] = useState(true);
  const [showError, setShowError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);

  const [isFavorite, setIsFavorite] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [isTogglingFavorite, setIsTogglingFavorite] = useState(false);
  const [isTogglingArchive, setIsTogglingArchive] = useState(false);
  const [isAddingToWatchlist, setIsAddingToWatchlist] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [removeSnapshot, setRemoveSnapshot] = useState<RemovedShowSnapshot | null>(null);
  const [removeSnackbarVisible, setRemoveSnackbarVisible] = useState(false);
  const [addedSnackbarVisible, setAddedSnackbarVisible] = useState(false);
  // Outside-row "mark season watched" (Phase D) — only one season's toggle
  // can be in flight at a time, matching the single shared CascadeModal
  // instance below (there's only ever one modal on screen regardless of
  // which row triggered it).
  const [togglingSeasonNumber, setTogglingSeasonNumber] = useState<number | null>(null);

  // The watchlist row for this show (if the user has tracked it at all)
  // lives in the Zustand store, not on the show-detail response itself —
  // ShowDetailView returns TMDB metadata, not per-user tracking state.
  const watchlistEntry =
    !Number.isNaN(tmdbId)
      ? [
          ...watchlist.to_watch.results,
          ...watchlist.up_to_date.results,
          ...watchlist.archived.results,
        ].find((entry) => entry.show.tmdb_id === tmdbId) ?? null
      : null;

  useEffect(() => {
    if (watchlistEntry) {
      setIsFavorite(watchlistEntry.is_favorite);
      setIsArchived(watchlistEntry.status === 'ARCHIVED');
    } else {
      // Entry can now disappear without leaving this screen (Phase F's
      // Remove action) — previously the only way watchlistEntry went from
      // set to null was navigating away, so these never went stale in place.
      setIsFavorite(false);
      setIsArchived(false);
    }
  }, [watchlistEntry]);

  const loadShow = useCallback(async () => {
    if (Number.isNaN(tmdbId)) {
      setShowError('Invalid show id.');
      setIsLoadingShow(false);
      return;
    }
    setIsLoadingShow(true);
    setShowError(null);
    try {
      const response = await api.get<Show>(`/shows/${tmdbId}/`);
      setShow(response.data);
    } catch (error) {
      setShowError(extractErrorMessage(error));
    } finally {
      setIsLoadingShow(false);
    }
  }, [tmdbId]);

  const loadSecondaryData = useCallback(async () => {
    if (Number.isNaN(tmdbId)) return;
    setSectionError(null);

    const [creditsResult, recsResult, providersResult] = await Promise.allSettled([
      api.get<{ cast: CastMember[]; crew: CrewMember[] }>(`/shows/${tmdbId}/credits/`),
      api.get<{ results: RecommendationItem[] }>(`/shows/${tmdbId}/recommendations/`),
      api.get<ProviderItem[]>(`/shows/${tmdbId}/watch-providers/`),
    ]);

    if (creditsResult.status === 'fulfilled') {
      setCast(creditsResult.value.data.cast);
      setCrew(creditsResult.value.data.crew);
    }
    if (recsResult.status === 'fulfilled') {
      setRecommendations(recsResult.value.data.results);
    }
    if (providersResult.status === 'fulfilled') {
      setProviders(providersResult.value.data);
    }

    // Only surface an error banner if every section failed — a single
    // missing section (e.g. no providers in this region) is normal.
    if (
      creditsResult.status === 'rejected' &&
      recsResult.status === 'rejected' &&
      providersResult.status === 'rejected'
    ) {
      setSectionError(extractErrorMessage((creditsResult as PromiseRejectedResult).reason));
    }
  }, [tmdbId]);

  useEffect(() => {
    loadShow();
    loadSecondaryData();
    fetchWatchlist();
  }, [loadShow, loadSecondaryData, fetchWatchlist]);

  const handleToggleFavorite = async () => {
    if (Number.isNaN(tmdbId) || isTogglingFavorite) return;
    setIsTogglingFavorite(true);
    const previous = isFavorite;
    setIsFavorite(!previous);
    try {
      await api.post('/watchlist/favorite/', { show_id: tmdbId });
      await fetchWatchlist();
    } catch (error) {
      setIsFavorite(previous);
      setSectionError(extractErrorMessage(error));
    } finally {
      setIsTogglingFavorite(false);
    }
  };

  /** Phase I: no forced navigation on add — the pill itself already flips to
   *  "In Watchlist" the moment `watchlistEntry` becomes truthy (the store's
   *  optimistic update in `addShowToWatchlist`), so the only thing missing
   *  without a redirect was a moment of confirmation; a Snackbar covers
   *  that without taking the user off the screen they were already on.
   *  `success`'s job changes from "should I navigate" to "should I confirm"
   *  — the underlying optimistic-add/error-rollback in the store is
   *  unchanged either way. */
  const handleAddToWatchlist = async () => {
    if (Number.isNaN(tmdbId) || isAddingToWatchlist || watchlistEntry) return;
    setIsAddingToWatchlist(true);
    const success = await addShowToWatchlist(tmdbId);
    setIsAddingToWatchlist(false);
    if (success) {
      setAddedSnackbarVisible(true);
    }
  };

  const handleToggleArchive = async () => {
    if (Number.isNaN(tmdbId) || isTogglingArchive) return;
    setIsTogglingArchive(true);
    const previous = isArchived;
    setIsArchived(!previous);
    try {
      await api.post('/watchlist/archive/', { show_id: tmdbId, archived: !previous });
      await fetchWatchlist();
    } catch (error) {
      setIsArchived(previous);
      setSectionError(extractErrorMessage(error));
    } finally {
      setIsTogglingArchive(false);
    }
  };

  /** Full-delete "Remove from Watchlist" (Phase F) — acts immediately (same
   *  pattern as the Catch-Up cascade's own Undo: commit now, offer a real
   *  reversal, not a deferred commit) and shows Snackbar's Undo, which
   *  replays the server-returned snapshot exactly rather than trusting
   *  whatever this screen happens to have in local state. */
  const handleRemoveFromWatchlist = async () => {
    if (Number.isNaN(tmdbId) || isRemoving || !watchlistEntry) return;
    setIsRemoving(true);
    const snapshot = await removeShowFromWatchlist(tmdbId);
    setIsRemoving(false);
    if (snapshot) {
      setRemoveSnapshot(snapshot);
      setRemoveSnackbarVisible(true);
    } else {
      setSectionError('Could not remove from watchlist — try again.');
    }
  };

  const handleUndoRemove = async () => {
    setRemoveSnackbarVisible(false);
    if (!removeSnapshot) return;
    const snapshot = removeSnapshot;
    setRemoveSnapshot(null);
    await undoRemoveShow(snapshot);
  };

  const displayShow = show || watchlistEntry?.show || (fallbackTitle ? {
    tmdb_id: tmdbId,
    title: fallbackTitle,
    poster_path: fallbackPoster || null,
    vote_average: Number(fallbackVote) || 0,
    backdrop_path: fallbackBackdrop || null,
    genres: [],
    status: 'UNKNOWN' as any,
    first_air_date: null,
    overview: fallbackOverview || null,
    total_seasons: 0,
  } as unknown as Show : null);

  // Per-season aired/watched counts, derived from whatever seasons are
  // already cached in this show's Zustand watchlist entry (`entry.show.episodes`
  // — the same source lib/upcoming.ts reads). A season the user has never
  // opened isn't in there yet, so it's simply absent from this map — SeasonCard
  // already renders "Tap to view episodes" for that case (hasCounts=false),
  // same as before this phase.
  const today = useMemo(() => todayLocalIso(), []);
  const seasonProgress = useMemo(() => {
    const map = new Map<number, { episodeCount: number; watchedCount: number }>();
    const episodes = watchlistEntry?.show.episodes ?? [];
    for (const ep of episodes) {
      if (!ep.air_date || ep.air_date > today) continue;
      const bucket = map.get(ep.season_number) ?? { episodeCount: 0, watchedCount: 0 };
      bucket.episodeCount += 1;
      if (ep.is_watched) bucket.watchedCount += 1;
      map.set(ep.season_number, bucket);
    }
    return map;
  }, [watchlistEntry?.show.episodes, today]);

  /** Shared finalize step for both the direct-unmark path and every
   *  CascadeModal outcome (confirm/cancel/never-for-show) — identical
   *  bulkToggleWatchState + refetch pattern as the season screen's own
   *  finalizeSeasonWatch, just without a local `episodes` copy to update
   *  optimistically (this screen doesn't keep one). */
  const finalizeSeasonWatch = useCallback(
    async (ids: number[], watched: boolean) => {
      if (ids.length === 0) {
        setTogglingSeasonNumber(null);
        return;
      }
      await bulkToggleWatchState(ids, watched);
      setTogglingSeasonNumber(null);
      fetchProfile();
      fetchWatchlist();
    },
    [bulkToggleWatchState, fetchProfile, fetchWatchlist]
  );

  const catchup = useCatchupCascade(finalizeSeasonWatch);

  /** SeasonCard's outside-row toggle. Always fetches the season fresh
   *  (same GET the season screen itself makes) rather than trusting
   *  `seasonProgress` — that map only reflects whatever's already cached
   *  locally, which can be stale or entirely absent for a season the user
   *  hasn't opened yet, and correctness here matters more than saving one
   *  request. Routes through the exact same server-side Catch-Up check
   *  and batched toggle the season screen uses — no second implementation
   *  of "mark season watched". */
  const handleToggleSeasonOutside = useCallback(
    async (seasonNumber: number) => {
      if (togglingSeasonNumber !== null || Number.isNaN(tmdbId)) return;
      setTogglingSeasonNumber(seasonNumber);
      try {
        const res = await api.get<Episode[]>(`/shows/${tmdbId}/season/${seasonNumber}/`);
        const aired = res.data.filter((ep) => ep.air_date && ep.air_date <= today);
        if (aired.length === 0) {
          setTogglingSeasonNumber(null);
          return;
        }
        const allWatched = aired.every((ep) => ep.is_watched);
        if (allWatched) {
          await finalizeSeasonWatch(aired.map((ep) => ep.tmdb_id), false);
          return;
        }
        const unwatchedIds = aired.filter((ep) => !ep.is_watched).map((ep) => ep.tmdb_id);
        const shown = await catchup.checkSeason(
          tmdbId,
          seasonNumber,
          unwatchedIds,
          displayShow?.title ?? '',
          `Season ${seasonNumber}`
        );
        if (!shown) {
          await finalizeSeasonWatch(unwatchedIds, true);
        }
        // If shown, togglingSeasonNumber stays set until the modal resolves —
        // every CascadeModal outcome (confirm/cancel/neverForShow) calls
        // onFinalize (finalizeSeasonWatch above), which clears it.
      } catch (err) {
        setSectionError(extractErrorMessage(err));
        setTogglingSeasonNumber(null);
      }
    },
    [togglingSeasonNumber, tmdbId, today, catchup, finalizeSeasonWatch, displayShow]
  );

  if (isLoadingShow && !displayShow) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (showError && !displayShow) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.header}>
          <PressableScale onPress={() => goBack(router)} hitSlop={8} style={styles.iconButton}>
            <ArrowLeft color={c.textPrimary} size={22} />
          </PressableScale>
        </View>
        <View style={styles.centered}>
          <GlassSurface radius={18} style={styles.errorCard}>
            <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
            <Text style={[styles.errorText, { color: c.textSecondary }]}>{showError ?? 'Show not found.'}</Text>
            <PressableScale style={[styles.retryButton, { backgroundColor: c.accentFill }]} onPress={loadShow}>
              <Text style={[styles.retryButtonText, { color: c.onAccent }]}>Retry</Text>
            </PressableScale>
          </GlassSurface>
        </View>
      </SafeAreaView>
    );
  }

  const seasonNumbers = Array.from({ length: Math.max(displayShow?.total_seasons || 0, 1) }, (_, i) => i + 1);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Backdrop + floating header controls sit on top of a photo, not the
            app's own background — kept a fixed dark scrim/white icon set in
            both themes, same "caption on a photo" precedent as HeroCarousel
            and SearchResultCard's badges. Accent-colored active states still
            pull from the token (accentFill is identical in both themes). */}
        <View style={styles.backdropWrap}>
          <Image
            source={displayShow?.backdrop_path ? { uri: `${BACKDROP_BASE_URL}${displayShow.backdrop_path}` } : undefined}
            style={[styles.backdrop, { backgroundColor: c.bgElevated }]}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.backdropOverlay} />
          <View style={styles.headerFloating}>
            <PressableScale onPress={() => goBack(router)} hitSlop={8} style={styles.iconButton}>
              <ArrowLeft color="#FFFFFF" size={22} />
            </PressableScale>
            <View style={styles.headerActions}>
              <PressableScale
                onPress={() => router.push(`/show/${tmdbId}/comments`)}
                hitSlop={8}
                style={styles.iconButton}
              >
                <MessageCircle color="#FFFFFF" size={20} />
              </PressableScale>
              <PressableScale
                onPress={handleToggleArchive}
                disabled={isTogglingArchive}
                hitSlop={8}
                style={styles.iconButton}
              >
                {isArchived ? (
                  <ArchiveRestore color={c.accentFill} size={20} />
                ) : (
                  <Archive color="#FFFFFF" size={20} />
                )}
              </PressableScale>
              <PressableScale
                onPress={handleToggleFavorite}
                disabled={isTogglingFavorite}
                hitSlop={8}
                style={styles.iconButton}
              >
                <Heart
                  color={isFavorite ? c.accentFill : '#FFFFFF'}
                  fill={isFavorite ? c.accentFill : 'transparent'}
                  size={20}
                />
              </PressableScale>
              {watchlistEntry && (
                <PressableScale
                  onPress={handleRemoveFromWatchlist}
                  disabled={isRemoving}
                  hitSlop={8}
                  style={styles.iconButton}
                  accessibilityRole="button"
                  accessibilityLabel="Remove from Watchlist"
                >
                  <Trash2 color="#FFFFFF" size={20} />
                </PressableScale>
              )}
            </View>
          </View>
        </View>

        <View style={styles.heroRow}>
          <Image
            source={displayShow?.poster_path ? { uri: `${POSTER_BASE_URL}${displayShow.poster_path}` } : undefined}
            style={[styles.poster, { backgroundColor: c.bgElevated, borderColor: c.bg }]}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.heroTextColumn}>
            <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={3}>
              {displayShow?.title}
            </Text>
            <View style={styles.metaRow}>
              <Star color={c.accentInk} size={13} fill={c.accentInk} />
              <Text style={[styles.metaText, { color: c.textSecondary }]}>{displayShow?.vote_average?.toFixed(1) || '0.0'}</Text>
              {displayShow?.status && displayShow.status !== ('UNKNOWN' as any) && (
                <>
                  <Text style={[styles.metaDot, { color: c.textTertiary }]}>·</Text>
                  <Text style={[styles.metaText, { color: c.textSecondary }]}>{STATUS_LABEL[displayShow.status]}</Text>
                </>
              )}
            </View>
            {displayShow?.first_air_date ? (
              <Text style={[styles.metaText, { color: c.textSecondary }]}>{displayShow.first_air_date.slice(0, 4)}</Text>
            ) : null}

            {!Number.isNaN(tmdbId) && (
              <PressableScale
                style={[
                  styles.addBtn,
                  { backgroundColor: c.accentDim, borderColor: c.accentInk },
                  watchlistEntry && { backgroundColor: c.accentFill, borderColor: c.accentFill },
                ]}
                onPress={handleAddToWatchlist}
                disabled={isAddingToWatchlist || !!watchlistEntry}
                accessibilityRole="button"
                accessibilityLabel={watchlistEntry ? 'In Watchlist' : 'Add to Watchlist'}
              >
                {watchlistEntry ? (
                  <CheckCircle color={c.onAccent} size={15} strokeWidth={2.5} />
                ) : (
                  <Plus color={c.accentInk} size={15} strokeWidth={2.5} />
                )}
                <Text style={[styles.addBtnText, { color: c.accentInk }, watchlistEntry && { color: c.onAccent }]}>
                  {watchlistEntry ? 'In Watchlist' : 'Add to Watchlist'}
                </Text>
              </PressableScale>
            )}
          </View>
        </View>

        {(displayShow?.genres?.length ?? 0) > 0 && (
          <View style={styles.genreRow}>
            {displayShow?.genres.map((genre) => (
              <View key={genre} style={[styles.genreChip, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <Text style={[styles.genreChipText, { color: c.textSecondary }]}>{genre}</Text>
              </View>
            ))}
          </View>
        )}

        {watchlistEntry && (
          <GlassSurface radius={16} style={styles.progressCard}>
            <ProgressRing percentage={watchlistEntry.progress_percentage} size={52} strokeWidth={5} />
            <View style={styles.progressTextColumn}>
              <Text style={[styles.progressTitle, { color: c.textPrimary }]}>Your Progress</Text>
              <Text style={[styles.progressSubtitle, { color: c.textSecondary }]}>
                {watchlistEntry.watched_episode_count} of {watchlistEntry.aired_episode_count}{' '}
                aired episodes watched
              </Text>
            </View>
          </GlassSurface>
        )}

        {!Number.isNaN(tmdbId) && (
          <View style={styles.section}>
            <RatingReviewCard mediaType="show" tmdbId={tmdbId} />
          </View>
        )}

        {displayShow?.overview ? <Text style={[styles.overview, { color: c.textSecondary }]}>{displayShow.overview}</Text> : null}

        {sectionError && (
          <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
            <Text style={[styles.errorBannerText, { color: c.negative }]}>{sectionError}</Text>
          </View>
        )}

        {providers.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Where to Watch</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {providers.map((provider, index) => (
                <ProviderBadge
                  key={`${provider.provider_id}-${index}`}
                  providerName={provider.provider_name}
                  logoPath={provider.logo_path}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {displayShow?.total_seasons && displayShow.total_seasons > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Seasons</Text>
          <View style={styles.seasonList}>
            {seasonNumbers.map((seasonNumber) => {
              const progress = seasonProgress.get(seasonNumber);
              return (
                <SeasonCard
                  key={seasonNumber}
                  seasonNumber={seasonNumber}
                  showPosterPath={displayShow?.poster_path}
                  episodeCount={progress?.episodeCount}
                  watchedCount={progress?.watchedCount}
                  onPress={() => router.push(`/show/${tmdbId}/season/${seasonNumber}`)}
                  onToggleWatched={
                    watchlistEntry ? () => handleToggleSeasonOutside(seasonNumber) : undefined
                  }
                  isTogglingWatched={togglingSeasonNumber === seasonNumber}
                />
              );
            })}
          </View>
        </View>
        ) : null}

        {cast.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Cast</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {cast.map((member) => (
                <CastCard
                  key={member.person_id}
                  name={member.name}
                  role={member.character}
                  profilePath={member.profile_path}
                  footnote={
                    member.episode_count
                      ? `${member.episode_count} episode${member.episode_count === 1 ? '' : 's'}`
                      : undefined
                  }
                />
              ))}
            </ScrollView>
          </View>
        )}

        {crew.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Crew</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {crew.map((member) => (
                <CastCard
                  key={`${member.person_id}-${member.job}`}
                  name={member.name}
                  role={member.job}
                  profilePath={member.profile_path}
                  footnote={member.department}
                />
              ))}
            </ScrollView>
          </View>
        )}

        {recommendations.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>You Might Also Like</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horizontalList}>
              {recommendations.map((item) => (
                <PressableScale
                  key={item.tmdb_id}
                  style={styles.recCard}
                  onPress={() =>
                    router.push({
                      pathname: `/show/${item.tmdb_id}` as any,
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
                    source={item.poster_path ? { uri: `${REC_POSTER_BASE_URL}${item.poster_path}` } : undefined}
                    style={[styles.recPoster, { backgroundColor: c.bgElevated }]}
                    contentFit="cover"
                    transition={150}
                  />
                  <Text style={[styles.recTitle, { color: c.textSecondary }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <CascadeModal
        visible={catchup.visible}
        showTitle={catchup.showTitle}
        episodeLabel={catchup.episodeLabel}
        previousCount={catchup.previousCount}
        onConfirm={catchup.confirm}
        onCancel={catchup.cancel}
        onNeverForThisShow={catchup.neverForShow}
      />

      <Snackbar
        visible={catchup.undoVisible}
        message={`Marked ${catchup.undoCount} episode${catchup.undoCount !== 1 ? 's' : ''} watched`}
        actionLabel="UNDO"
        onAction={catchup.performUndo}
        onDismiss={catchup.dismissUndo}
      />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 48 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingHorizontal: 32,
  },
  header: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  backdropWrap: {
    height: 220,
    width: '100%',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  // Photo-caption overlay — fixed dark scrim over the backdrop photo,
  // theme-invariant by design (see comment at the call site).
  backdropOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  headerFloating: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  // Floating icon buttons over the backdrop photo — fixed dark circle +
  // white icons for legibility against an arbitrary photo, theme-invariant.
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroRow: {
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 20,
    marginTop: -48,
  },
  poster: {
    width: 100,
    height: 150,
    borderRadius: 14,
    borderWidth: 2,
  },
  heroTextColumn: {
    flex: 1,
    justifyContent: 'flex-end',
    gap: 6,
    paddingBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metaDot: {
    fontSize: 12,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
    marginTop: 8,
  },
  addBtnText: { fontSize: 12, fontWeight: '700' },
  genreRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    marginTop: 12,
  },
  genreChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  genreChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 14,
  },
  progressTextColumn: {
    flex: 1,
    gap: 2,
  },
  progressTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  progressSubtitle: {
    fontSize: 12,
  },
  overview: {
    fontSize: 13,
    lineHeight: 20,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  section: {
    marginTop: 24,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    paddingHorizontal: 20,
  },
  seasonList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  horizontalList: {
    paddingHorizontal: 20,
    gap: 10,
  },
  recCard: {
    width: 110,
    gap: 6,
  },
  recPoster: {
    width: 110,
    height: 165,
    borderRadius: 12,
  },
  recTitle: {
    fontSize: 11,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorCard: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 28,
    paddingVertical: 32,
    width: '100%',
  },
  errorBanner: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBannerText: {
    fontSize: 12,
  },
  retryButton: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});