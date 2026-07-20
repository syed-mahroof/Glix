// client-mobile/app/episode/[id].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ArrowLeft, Check, Clapperboard, Eye, PenTool, Star, WifiOff } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CastCard } from '../../components/CastCard';
import CascadeModal from '../../components/CascadeModal';
import { EmotionPicker } from '../../components/EmotionPicker';
import GlassSurface from '../../components/GlassSurface';
import { MVPVotingSheet } from '../../components/MVPVotingSheet';
import PressableScale from '../../components/PressableScale';
import { ProviderBadge } from '../../components/ProviderBadge';
import Snackbar from '../../components/Snackbar';
import { api } from '../../lib/api';
import { pad, todayLocalIso } from '../../lib/dateFormat';
import { extractErrorMessage } from '../../lib/errors';
import { useAppTheme } from '../../lib/theme';
import { useCatchupCascade } from '../../lib/useCatchupCascade';
import { Emotion, useWatchStore } from '../../store/watchStore';

const STILL_BASE_URL = 'https://image.tmdb.org/t/p/w780';

interface EpisodeShowSummary {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

interface EpisodeCastMember {
  person_id: number;
  name: string;
  character: string;
  profile_path: string | null;
}

interface EpisodeCredits {
  cast: EpisodeCastMember[];
  guest_stars: EpisodeCastMember[];
  directors: string[];
  writers: string[];
}

interface EpisodeInteractionState {
  emotion_emoji: Emotion | '';
  mvp_character_id: number | null;
  mvp_character_name: string;
}

interface EpisodeDetail {
  tmdb_id: number;
  season_number: number;
  episode_number: number;
  title: string;
  overview: string;
  air_date: string | null;
  runtime_minutes: number;
  still_path: string | null;
  is_watched: boolean;
  show: EpisodeShowSummary;
  credits: EpisodeCredits;
  interaction: EpisodeInteractionState | null;
}

interface ProviderItem {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
}

export default function EpisodeDetailScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { id } = useLocalSearchParams<{ id: string }>();
  const episodeId = Number(id);

  const fetchProfile = useWatchStore((state) => state.fetchProfile);
  const fetchWatchlist = useWatchStore((state) => state.fetchWatchlist);
  const bulkToggleWatchState = useWatchStore((state) => state.bulkToggleWatchState);

  const [episode, setEpisode] = useState<EpisodeDetail | null>(null);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);

  const [isTogglingWatched, setIsTogglingWatched] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const [emotion, setEmotion] = useState<Emotion | null>(null);
  const [mvpCharacterId, setMvpCharacterId] = useState<number | null>(null);
  const [mvpCharacterName, setMvpCharacterName] = useState<string>('');
  const [isSavingEmotion, setIsSavingEmotion] = useState(false);
  const [isMvpSheetVisible, setIsMvpSheetVisible] = useState(false);

  const loadEpisode = useCallback(async () => {
    if (Number.isNaN(episodeId)) {
      setError('Invalid episode id.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await api.get<EpisodeDetail>(`/episodes/${episodeId}/`);
      const data = response.data;
      setEpisode(data);
      setIsRevealed(data.is_watched);
      if (data.interaction) {
        setEmotion(data.interaction.emotion_emoji || null);
        setMvpCharacterId(data.interaction.mvp_character_id);
        setMvpCharacterName(data.interaction.mvp_character_name);
      }

      try {
        const providersRes = await api.get<ProviderItem[]>(
          `/shows/${data.show.tmdb_id}/watch-providers/`
        );
        setProviders(providersRes.data);
      } catch {
        // Non-critical — providers section just stays empty for this region/show.
      }

      // The Catch-Up modal's check (below) is a server-authoritative call
      // (CatchupCheckView) that no longer depends on the Zustand watchlist
      // being fresh. Still kept so the store (Shows Hub pills, widget data)
      // reflects this episode's watched state after navigating back.
      await fetchWatchlist();
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [episodeId, fetchWatchlist]);

  useEffect(() => {
    loadEpisode();
  }, [loadEpisode]);

  /** Marks the given episode ids watched via the batched endpoint —
   *  shared `onFinalize` for the Catch-Up modal's three outcomes. This
   *  screen only ever renders one episode, so it optimistically flips
   *  just that one locally; any prior-episode ids from a "confirm" are
   *  updated in the Zustand store by bulkToggleWatchState itself. */
  const finalizeEpisodeWatch = useCallback(
    async (ids: number[], watched: boolean) => {
      setIsTogglingWatched(true);
      setEpisode((prev) => (prev ? { ...prev, is_watched: watched } : prev));
      if (watched) setIsRevealed(true);
      await bulkToggleWatchState(ids, watched);
      setIsTogglingWatched(false);
      fetchProfile();
      fetchWatchlist();
    },
    [bulkToggleWatchState, fetchProfile, fetchWatchlist]
  );

  const catchup = useCatchupCascade(finalizeEpisodeWatch);

  const handleToggleWatched = async () => {
    if (!episode || isTogglingWatched) return;

    if (episode.is_watched) {
      // Un-watching: no catch-up concern, immediate single toggle.
      setIsTogglingWatched(true);
      setEpisode({ ...episode, is_watched: false });
      try {
        await api.post('/watch-state/toggle/', { episode_id: episode.tmdb_id });
        fetchProfile();
        fetchWatchlist();
      } catch (err) {
        setEpisode((prev) => (prev ? { ...prev, is_watched: true } : prev));
        setSectionError(extractErrorMessage(err));
      } finally {
        setIsTogglingWatched(false);
      }
      return;
    }

    // Can't mark a future episode watched.
    const todayIso = todayLocalIso();
    if (!episode.air_date || episode.air_date > todayIso) return;

    // Watching: check for chronologically-prior unwatched episodes first.
    // isTogglingWatched covers both this async check and the eventual
    // toggle, so the button shows its loading state for the whole flow
    // rather than looking unresponsive while the check is in flight.
    setIsTogglingWatched(true);
    const label = `S${pad(episode.season_number)}E${pad(episode.episode_number)}`;
    const shown = await catchup.checkEpisode(episode.show.tmdb_id, episode.tmdb_id, episode.show.title, label);
    if (!shown) {
      await finalizeEpisodeWatch([episode.tmdb_id], true);
    } else {
      setIsTogglingWatched(false);
    }
  };

  const persistInteraction = async (payload: {
    emotion_emoji?: Emotion;
    mvp_character_id?: number;
    mvp_character_name?: string;
  }) => {
    if (!episode) return;
    await api.post('/episode/interaction/', { episode_id: episode.tmdb_id, ...payload });
  };

  const handleSelectEmotion = async (selected: Emotion) => {
    if (isSavingEmotion) return;
    const previous = emotion;
    setEmotion(selected);
    setIsSavingEmotion(true);
    try {
      await persistInteraction({ emotion_emoji: selected });
    } catch (err) {
      setEmotion(previous);
      setSectionError(extractErrorMessage(err));
    } finally {
      setIsSavingEmotion(false);
    }
  };

  const handleMvpVote = async (characterId: number, characterName: string) => {
    await persistInteraction({
      mvp_character_id: characterId,
      mvp_character_name: characterName,
    });
    setMvpCharacterId(characterId);
    setMvpCharacterName(characterName);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !episode) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
        <View style={styles.header}>
          <PressableScale onPress={() => router.back()} hitSlop={8} style={[styles.backButton, { backgroundColor: c.glassFill, borderColor: c.hairline, borderWidth: StyleSheet.hairlineWidth }]}>
            <ArrowLeft color={c.textPrimary} size={22} />
          </PressableScale>
        </View>
        <View style={styles.centered}>
          <GlassSurface radius={18} style={styles.errorCard}>
            <WifiOff color={c.textTertiary} size={32} strokeWidth={1.5} />
            <Text style={[styles.errorText, { color: c.textSecondary }]}>{error ?? 'Episode not found.'}</Text>
            <PressableScale style={[styles.retryBtn, { backgroundColor: c.accentDim, borderColor: c.accentInk }]} onPress={loadEpisode}>
              <Text style={[styles.retryText, { color: c.accentInk }]}>Retry</Text>
            </PressableScale>
          </GlassSurface>
        </View>
      </SafeAreaView>
    );
  }

  const showOverview = episode.is_watched || isRevealed;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Still frame + floating back button + show/episode caption sit on
            top of a photo, not the app's own background — kept a fixed dark
            scrim/white text in both themes, same precedent as
            show/[id].tsx's backdrop. Accent-colored label still pulls from
            the token (accentFill is identical in both themes). */}
        <View style={styles.stillWrap}>
          <Image
            source={episode.still_path ? { uri: `${STILL_BASE_URL}${episode.still_path}` } : undefined}
            style={[styles.still, { backgroundColor: c.bgElevated }]}
            contentFit="cover"
            transition={200}
          />
          <View style={styles.stillOverlay} />
          <View style={styles.headerFloating}>
            <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
              <ArrowLeft color="#FFFFFF" size={22} />
            </PressableScale>
          </View>
          <View style={styles.stillTextBlock}>
            <Text style={styles.showTitle} numberOfLines={1}>
              {episode.show.title}
            </Text>
            <Text style={[styles.episodeLabel, { color: c.accentFill }]}>
              S{pad(episode.season_number)}E{pad(episode.episode_number)}
            </Text>
          </View>
        </View>

        <View style={styles.content}>
          <Text style={[styles.title, { color: c.textPrimary }]}>{episode.title || `Episode ${episode.episode_number}`}</Text>

          <View style={styles.metaRow}>
            {episode.air_date ? <Text style={[styles.metaText, { color: c.textSecondary }]}>{episode.air_date}</Text> : null}
            {episode.runtime_minutes ? (
              <>
                <Text style={[styles.metaDot, { color: c.textTertiary }]}>·</Text>
                <Text style={[styles.metaText, { color: c.textSecondary }]}>{episode.runtime_minutes} min</Text>
              </>
            ) : null}
          </View>

          {(() => {
            const todayIso = todayLocalIso();
            const isAired = !!episode.air_date && episode.air_date <= todayIso;
            const lockedUnaired = !isAired && !episode.is_watched;
            return (
              <PressableScale
                onPress={handleToggleWatched}
                disabled={isTogglingWatched || lockedUnaired}
                style={[
                  styles.watchButton,
                  { borderColor: c.hairline },
                  episode.is_watched && { backgroundColor: c.accentFill, borderColor: c.accentFill },
                  lockedUnaired && styles.watchButtonDisabled,
                ]}
              >
                {isTogglingWatched ? (
                  <ActivityIndicator
                    size="small"
                    color={episode.is_watched ? c.onAccent : c.accentInk}
                  />
                ) : (
                  <>
                    {episode.is_watched && <Check color={c.onAccent} size={16} strokeWidth={3} />}
                    <Text
                      style={[
                        styles.watchButtonText,
                        { color: c.textPrimary },
                        episode.is_watched && { color: c.onAccent },
                      ]}
                    >
                      {episode.is_watched
                        ? 'Watched'
                        : lockedUnaired
                        ? "Hasn't Aired Yet"
                        : 'Mark as Watched'}
                    </Text>
                  </>
                )}
              </PressableScale>
            );
          })()}

          {sectionError && (
            <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
              <Text style={[styles.errorBannerText, { color: c.negative }]}>{sectionError}</Text>
            </View>
          )}

          {showOverview ? (
            <Text style={[styles.overview, { color: c.textSecondary }]}>{episode.overview || 'No description available.'}</Text>
          ) : (
            <PressableScale onPress={() => setIsRevealed(true)} style={styles.spoilerRow}>
              <Eye color={c.textTertiary} size={14} />
              <Text style={[styles.spoilerText, { color: c.textTertiary }]}>Tap to reveal synopsis</Text>
            </PressableScale>
          )}

          {(episode.credits.directors.length > 0 || episode.credits.writers.length > 0) && (
            <View style={styles.creditsRow}>
              {episode.credits.directors.length > 0 && (
                <View style={styles.creditsLine}>
                  <Clapperboard color={c.textSecondary} size={13} />
                  <Text style={[styles.creditsText, { color: c.textSecondary }]} numberOfLines={1}>
                    {episode.credits.directors.join(', ')}
                  </Text>
                </View>
              )}
              {episode.credits.writers.length > 0 && (
                <View style={styles.creditsLine}>
                  <PenTool color={c.textSecondary} size={13} />
                  <Text style={[styles.creditsText, { color: c.textSecondary }]} numberOfLines={1}>
                    {episode.credits.writers.join(', ')}
                  </Text>
                </View>
              )}
            </View>
          )}

          {providers.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Where to Watch</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalListInset}
              >
                {providers.map((provider) => (
                  <ProviderBadge
                    key={provider.provider_id}
                    providerName={provider.provider_name}
                    logoPath={provider.logo_path}
                  />
                ))}
              </ScrollView>
            </View>
          )}

          <View style={styles.section}>
            <View style={styles.reactionHeaderRow}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Your Reaction</Text>
              {isSavingEmotion && <ActivityIndicator size="small" color={c.accentInk} />}
            </View>
            <EmotionPicker value={emotion} onSelect={handleSelectEmotion} disabled={isSavingEmotion} />
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Episode MVP</Text>
            <PressableScale
              style={[styles.mvpButton, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
              onPress={() => setIsMvpSheetVisible(true)}
            >
              <Star color={c.accentInk} size={16} fill={mvpCharacterId ? c.accentInk : 'transparent'} />
              <Text style={[styles.mvpButtonText, { color: c.textPrimary }]}>
                {mvpCharacterName ? `MVP: ${mvpCharacterName}` : 'Vote for MVP'}
              </Text>
            </PressableScale>
          </View>

          {episode.credits.cast.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Cast</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalListInset}
              >
                {episode.credits.cast.map((member) => (
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

          {episode.credits.guest_stars.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Guest Stars</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalListInset}
              >
                {episode.credits.guest_stars.map((member) => (
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
        </View>
      </ScrollView>

      <MVPVotingSheet
        visible={isMvpSheetVisible}
        episodeId={episode.tmdb_id}
        currentMvpCharacterId={mvpCharacterId}
        onClose={() => setIsMvpSheetVisible(false)}
        onVote={handleMvpVote}
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
  stillWrap: {
    height: 210,
    width: '100%',
  },
  still: {
    ...StyleSheet.absoluteFillObject,
  },
  // Photo-caption overlay — fixed dark scrim over the still photo,
  // theme-invariant by design (see comment at the call site).
  stillOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  headerFloating: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  // Floating icon button over the still photo — fixed dark circle + white
  // icon for legibility against an arbitrary photo, theme-invariant.
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stillTextBlock: {
    position: 'absolute',
    bottom: 14,
    left: 20,
    right: 20,
    gap: 2,
  },
  // Photo-caption text — fixed translucent white, theme-invariant.
  showTitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  episodeLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 18,
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metaDot: {
    fontSize: 12,
  },
  watchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 14,
    height: 46,
    marginTop: 4,
  },
  watchButtonDisabled: {
    opacity: 0.4,
  },
  watchButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  overview: {
    fontSize: 13,
    lineHeight: 20,
  },
  spoilerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  spoilerText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  creditsRow: {
    gap: 4,
  },
  creditsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  creditsText: {
    fontSize: 12,
  },
  section: {
    marginTop: 10,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  reactionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  horizontalListInset: {
    gap: 10,
    paddingRight: 4,
  },
  mvpButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  mvpButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorBanner: {
    padding: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorBannerText: {
    fontSize: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  errorCard: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 28,
    paddingHorizontal: 24,
  },
  retryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  retryText: {
    fontSize: 14,
    fontWeight: '700',
  },
});