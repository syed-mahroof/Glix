// client-mobile/app/show/[id]/season/[season].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CheckCheck, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import CascadeModal from '../../../../components/CascadeModal';
import {
  ContinueWatchingCard,
  ContinueWatchingItem,
} from '../../../../components/ContinueWatchingCard';
import { EpisodeRow } from '../../../../components/EpisodeRow';
import GlassSurface from '../../../../components/GlassSurface';
import PressableScale from '../../../../components/PressableScale';
import { ProgressRing } from '../../../../components/ProgressRing';
import Snackbar from '../../../../components/Snackbar';
import { api } from '../../../../lib/api';
import { pad, todayLocalIso } from '../../../../lib/dateFormat';
import { extractErrorMessage } from '../../../../lib/errors';
import { useAppTheme } from '../../../../lib/theme';
import { useCatchupCascade } from '../../../../lib/useCatchupCascade';
import { Episode, useWatchStore } from '../../../../store/watchStore';

interface ShowSummary {
  tmdb_id: number;
  title: string;
}

export default function SeasonScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { id, season } = useLocalSearchParams<{ id: string; season: string }>();
  const tmdbId = Number(id);
  const seasonNumber = Number(season);

  const fetchProfile = useWatchStore((state) => state.fetchProfile);
  const fetchWatchlist = useWatchStore((state) => state.fetchWatchlist);
  const bulkToggleWatchState = useWatchStore((state) => state.bulkToggleWatchState);

  const [show, setShow] = useState<ShowSummary | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [continueWatchingItem, setContinueWatchingItem] = useState<ContinueWatchingItem | null>(
    null
  );

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [isMarkingSeasonWatched, setIsMarkingSeasonWatched] = useState(false);

  const isValidParams = !Number.isNaN(tmdbId) && !Number.isNaN(seasonNumber);

  const loadSeason = useCallback(async () => {
    if (!isValidParams) {
      setError('Invalid show or season.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [showRes, episodesRes] = await Promise.all([
        api.get<ShowSummary>(`/shows/${tmdbId}/`),
        api.get<Episode[]>(`/shows/${tmdbId}/season/${seasonNumber}/`),
      ]);
      setShow(showRes.data);
      setEpisodes(episodesRes.data);
      // The Catch-Up modal's check (below) is now a server-authoritative
      // call (CatchupCheckView) that reads straight from the DB and
      // eager-caches whatever it needs itself, so it no longer depends on
      // this refetch for correctness. Still kicked off: the Zustand watchlist
      // (Shows Hub pills, widget data) should reflect this season's
      // freshly-cached episodes too, so navigating back doesn't show stale
      // "next episode" state for this show. Not awaited — this screen
      // renders from its own local `episodes`/`show` state, never from the
      // Zustand watchlist, so blocking the spinner on a full unpaginated
      // `/watchlist/?page_size=all` refetch (fetchWatchlist already
      // swallows its own errors into store state) was pure added latency.
      fetchWatchlist();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [tmdbId, seasonNumber, isValidParams, fetchWatchlist]);

  const refreshContinueWatching = useCallback(async () => {
    if (!isValidParams) return;
    try {
      const response = await api.get<ContinueWatchingItem[]>('/continue-watching/');
      const match = response.data.find((item) => item.show.tmdb_id === tmdbId) ?? null;
      setContinueWatchingItem(match);
    } catch {
      // Non-critical — the season screen still works without this banner.
    }
  }, [tmdbId, isValidParams]);

  useEffect(() => {
    loadSeason();
    refreshContinueWatching();
  }, [loadSeason, refreshContinueWatching]);

  const today = useMemo(() => todayLocalIso(), []);
  const airedEpisodes = useMemo(
    () => episodes.filter((ep) => ep.air_date && ep.air_date <= today),
    [episodes, today]
  );
  const watchedCount = useMemo(
    () => airedEpisodes.filter((ep) => ep.is_watched).length,
    [airedEpisodes]
  );
  const progressPercentage = airedEpisodes.length
    ? Math.round((watchedCount / airedEpisodes.length) * 1000) / 10
    : 0;
  const allAiredWatched = airedEpisodes.length > 0 && watchedCount === airedEpisodes.length;

  /** Immediate single-episode toggle — no catch-up check. Used for
   *  un-watching (always immediate) and for watching when there's
   *  nothing chronologically prior to catch up on. */
  const executeImmediateToggle = useCallback(
    async (episodeId: number) => {
      setTogglingIds((prev) => new Set(prev).add(episodeId));
      const target = episodes.find((ep) => ep.tmdb_id === episodeId);
      const optimisticWatched = target ? !target.is_watched : true;

      setEpisodes((prev) =>
        prev.map((ep) => (ep.tmdb_id === episodeId ? { ...ep, is_watched: optimisticWatched } : ep))
      );

      try {
        await api.post('/watch-state/toggle/', { episode_id: episodeId });
        fetchProfile();
        fetchWatchlist();
        refreshContinueWatching();
      } catch (err) {
        setEpisodes((prev) =>
          prev.map((ep) =>
            ep.tmdb_id === episodeId ? { ...ep, is_watched: !optimisticWatched } : ep
          )
        );
        setError(extractErrorMessage(err));
      } finally {
        setTogglingIds((prev) => {
          const next = new Set(prev);
          next.delete(episodeId);
          return next;
        });
      }
    },
    [episodes, fetchProfile, fetchWatchlist, refreshContinueWatching]
  );

  /** Marks the given episode ids watched in a single batched request
   *  (`bulkToggleWatchState` → `POST /watch-state/bulk-toggle/`), not
   *  one request per episode — critical for a show with many prior
   *  unwatched seasons. Updates local `episodes` state optimistically
   *  too, since this screen keeps its own copy independent of the
   *  Zustand watchlist. Shared as the `onFinalize` callback for both
   *  the per-episode and per-season Catch-Up modal flows below. */
  const finalizeSeasonWatch = useCallback(
    async (ids: number[], watched: boolean) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      setEpisodes((prev) => prev.map((ep) => (idSet.has(ep.tmdb_id) ? { ...ep, is_watched: watched } : ep)));

      setIsMarkingSeasonWatched(true);
      setError(null);
      await bulkToggleWatchState(ids, watched);
      setIsMarkingSeasonWatched(false);

      fetchProfile();
      fetchWatchlist();
      refreshContinueWatching();
    },
    [bulkToggleWatchState, fetchProfile, fetchWatchlist, refreshContinueWatching]
  );

  const catchup = useCatchupCascade(finalizeSeasonWatch);

  /** Per-episode checkmark tap (EpisodeRow). Un-watching stays immediate;
   *  only the watch direction runs the chronological check. The check
   *  itself is now an async backend round-trip (CatchupCheckView), so this
   *  episode shows the same toggling spinner while it's in flight — not
   *  just during the eventual toggle — since a "nothing happens" tap would
   *  otherwise look broken for however long the network call takes. */
  const handleToggleEpisode = useCallback(
    async (episodeId: number) => {
      const target = episodes.find((ep) => ep.tmdb_id === episodeId);
      if (!target) return;

      if (target.is_watched) {
        executeImmediateToggle(episodeId);
        return;
      }

      const label = `S${pad(target.season_number)}E${pad(target.episode_number)}`;
      setTogglingIds((prev) => new Set(prev).add(episodeId));
      const shown = await catchup.checkEpisode(tmdbId, episodeId, show?.title ?? '', label);
      setTogglingIds((prev) => {
        const next = new Set(prev);
        next.delete(episodeId);
        return next;
      });
      if (!shown) {
        executeImmediateToggle(episodeId);
      }
    },
    [episodes, catchup, tmdbId, show, executeImmediateToggle]
  );

  const handleMarkSeasonWatched = useCallback(async () => {
    const seasonUnwatchedIds = airedEpisodes.filter((ep) => !ep.is_watched).map((ep) => ep.tmdb_id);
    if (seasonUnwatchedIds.length === 0) return;

    setIsMarkingSeasonWatched(true);
    const shown = await catchup.checkSeason(
      tmdbId,
      seasonNumber,
      seasonUnwatchedIds,
      show?.title ?? '',
      `Season ${seasonNumber}`
    );
    if (!shown) {
      await finalizeSeasonWatch(seasonUnwatchedIds, true);
    } else {
      setIsMarkingSeasonWatched(false);
    }
  }, [airedEpisodes, catchup, tmdbId, seasonNumber, show, finalizeSeasonWatch]);

  /** Dynamic Mark/Unmark toggle (user-requested): once every aired episode
   *  in the season is watched, the button flips to "Unmark Season Watched"
   *  and, on tap, un-marks all of them in one batched request — no
   *  Catch-Up check needed for the un-watch direction, same rule as every
   *  other un-watch path in the app. */
  const handleToggleSeasonWatched = useCallback(() => {
    if (allAiredWatched) {
      const watchedIds = airedEpisodes.filter((ep) => ep.is_watched).map((ep) => ep.tmdb_id);
      finalizeSeasonWatch(watchedIds, false);
    } else {
      handleMarkSeasonWatched();
    }
  }, [allAiredWatched, airedEpisodes, finalizeSeasonWatch, handleMarkSeasonWatched]);

  const handleEpisodePress = useCallback(
    (episodeId: number) => {
      router.push(`/episode/${episodeId}`);
    },
    [router]
  );

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <View style={styles.headerTextColumn}>
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Season {seasonNumber}</Text>
          {show ? (
            <Text style={[styles.headerSubtitle, { color: c.textSecondary }]} numberOfLines={1}>
              {show.title}
            </Text>
          ) : null}
        </View>
      </View>

      {error && (
        <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
          <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
        </View>
      )}

      <FlatList
        data={episodes}
        keyExtractor={(episode) => String(episode.tmdb_id)}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {continueWatchingItem && (
              <ContinueWatchingCard
                item={continueWatchingItem}
                onPress={() =>
                  continueWatchingItem.next_episode &&
                  router.push(`/episode/${continueWatchingItem.next_episode.tmdb_id}`)
                }
              />
            )}

            <GlassSurface radius={16} style={styles.progressCard}>
              <ProgressRing percentage={progressPercentage} size={52} strokeWidth={5} />
              <View style={styles.progressTextColumn}>
                <Text style={[styles.progressTitle, { color: c.textPrimary }]}>Season Progress</Text>
                <Text style={[styles.progressSubtitle, { color: c.textSecondary }]}>
                  {watchedCount} of {airedEpisodes.length} aired episodes watched
                </Text>
              </View>
            </GlassSurface>

            <PressableScale
              onPress={handleToggleSeasonWatched}
              disabled={isMarkingSeasonWatched || airedEpisodes.length === 0}
              style={[
                styles.markButton,
                allAiredWatched
                  ? { backgroundColor: 'transparent', borderWidth: StyleSheet.hairlineWidth, borderColor: c.accentDim }
                  : { backgroundColor: c.accentFill },
                airedEpisodes.length === 0 && styles.markButtonDisabled,
              ]}
            >
              {isMarkingSeasonWatched ? (
                <ActivityIndicator color={allAiredWatched ? c.accentInk : c.onAccent} size="small" />
              ) : allAiredWatched ? (
                <>
                  <X color={c.accentInk} size={16} strokeWidth={2.5} />
                  <Text style={[styles.markButtonText, { color: c.accentInk }]}>Unmark Season Watched</Text>
                </>
              ) : (
                <>
                  <CheckCheck color={c.onAccent} size={16} strokeWidth={2.5} />
                  <Text style={[styles.markButtonText, { color: c.onAccent }]}>Mark Season Watched</Text>
                </>
              )}
            </PressableScale>
          </View>
        }
        renderItem={({ item }) => (
          <EpisodeRow
            episode={item}
            onToggleWatched={handleToggleEpisode}
            onPress={handleEpisodePress}
            isToggling={togglingIds.has(item.tmdb_id)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextColumn: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 12,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  listHeader: {
    gap: 14,
    marginBottom: 16,
  },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
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
  markButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    height: 48,
  },
  markButtonDisabled: {
    opacity: 0.4,
  },
  markButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  separator: {
    height: 10,
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: {
    fontSize: 13,
  },
});