// client-mobile/app/(tabs)/profile.tsx
// Phase 5: Full Profile Hub — User header, social stats bar, watch stats,
// Shows/Movies navigation, Data Migration section, badges & insights.
// Phase 12: theme-aware (light/dark), dead-weight audit fixes applied —
// removed the redundant header Search button (search lives in Discover)
// and the dead "Create a New List" row (onPress={() => {}}, no backing
// feature); collapsed the social bar from 4 cells to the 2 that are real
// (Shows/Movies) — Following/Followers were hard-coded 0s with a TODO,
// no social graph exists yet. They return the day one ships, not before.

import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import {
  BarChart2,
  ChevronRight,
  Download,
  Film,
  Settings,
  Star,
  Trophy,
  Tv2,
  Upload,
  Users,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AvatarPickerModal from '../../components/AvatarPickerModal';
import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { ProgressRing } from '../../components/ProgressRing';
import { BADGE_META } from '../../lib/badges';
import {
  exportGlixData,
  importTVTimeData,
  pollImportJob,
  type ImportResult,
} from '../../lib/migration';
import { useAppTheme } from '../../lib/theme';
import { monoLabelStyle, monoValueStyle } from '../../lib/typography';
import { useWatchStore } from '../../store/watchStore';

export default function ProfileScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const profile = useWatchStore((state) => state.profile);
  const isLoadingProfile = useWatchStore((state) => state.isLoadingProfile);
  const fetchProfile = useWatchStore((state) => state.fetchProfile);
  const fetchWatchlist = useWatchStore((state) => state.fetchWatchlist);
  const fetchMovieWatchlist = useWatchStore((state) => state.fetchMovieWatchlist);
  const updateProfilePicture = useWatchStore((state) => state.updateProfilePicture);
  const watchlist = useWatchStore((state) => state.watchlist);
  const movieWatchlist = useWatchStore((state) => state.movieWatchlist);

  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  // Live job state while an import runs, driving the ProgressRing.
  // Null whenever no import is in flight.
  const [importJob, setImportJob] = useState<ImportResult | null>(null);
  const [importModal, setImportModal] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    title: string;
    message: string;
    stats?: { shows: number; movies: number; episodes: number; errors: number };
  }>({ visible: false, type: 'success', title: '', message: '' });

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const initials = useMemo(() => {
    if (!profile?.username) return '?';
    return profile.username.slice(0, 2).toUpperCase();
  }, [profile?.username]);

  // Computed watch stats
  const totalShows = useMemo(() => {
    return (
      watchlist.to_watch.results.length +
      watchlist.up_to_date.results.length +
      watchlist.archived.results.length
    );
  }, [watchlist]);

  // Total tracked movies — must match the "My Movies" row's count badge
  // below (watch_next + watched). A prior version of this stat counted only
  // *watched* movies, which visibly disagreed with the row badge on the
  // same screen (e.g. "1" here vs "4" on "My Movies") — the same
  // inconsistency `totalShows` avoids by counting every tracked show, not
  // just finished ones.
  const totalMovies = useMemo(() => {
    return movieWatchlist.watch_next.length + movieWatchlist.watched.length;
  }, [movieWatchlist]);

  // Time display from profile
  const watchedMonths = useMemo(() => {
    if (!profile?.watched_days) return 0;
    return Math.floor(profile.watched_days / 30);
  }, [profile?.watched_days]);

  const remainderDays = useMemo(() => {
    if (!profile?.watched_days) return 0;
    return profile.watched_days % 30;
  }, [profile?.watched_days]);

  // ── Import handler ──────────────────────────────────────────────────────────
  // The POST only enqueues; resolving a full export against TMDB takes
  // minutes on a worker, so this polls the job to completion and lets the
  // ProgressRing track it rather than blocking on one long request.
  const handleImport = useCallback(async () => {
    setIsImporting(true);
    setImportJob(null);
    try {
      const handle = await importTVTimeData();
      if (!handle) {
        return; // User cancelled the picker
      }

      const job = await pollImportJob(handle.job_id, setImportJob);

      if (job.status === 'FAILED') {
        setImportModal({
          visible: true,
          type: 'error',
          title: 'Import Failed',
          message:
            job.detail || 'The import could not be completed. Please try again.',
        });
        return;
      }

      setImportModal({
        visible: true,
        type: 'success',
        title: 'Import Complete',
        message: `${job.episodes_marked} episodes marked as watched, with their original watch dates.`,
        stats: {
          shows: job.shows_imported,
          movies: job.movies_imported,
          episodes: job.episodes_marked,
          errors: job.shows_skipped + job.movies_skipped,
        },
      });

      // Repopulate the UI so imported data is visible immediately rather
      // than after an app restart. Watchlist and movies are what the
      // import actually wrote; profile carries the recomputed
      // total_time_watched and badges.
      await Promise.all([fetchProfile(), fetchWatchlist(), fetchMovieWatchlist()]);
    } catch (err: any) {
      setImportModal({
        visible: true,
        type: 'error',
        title: 'Import Failed',
        message: err?.message ?? 'An unexpected error occurred while reading or processing the file.',
      });
    } finally {
      setIsImporting(false);
      setImportJob(null);
    }
  }, [fetchProfile, fetchWatchlist, fetchMovieWatchlist]);

  // ── Export handler ──────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    setIsExporting(true);
    try {
      await exportGlixData();
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message ?? 'An unexpected error occurred.');
    } finally {
      setIsExporting(false);
    }
  }, []);

  // ── Avatar picker ────────────────────────────────────────────────────────
  const handleSelectAvatar = useCallback(
    async (url: string) => {
      setAvatarPickerVisible(false);
      const ok = await updateProfilePicture(url);
      if (!ok) {
        Alert.alert('Update Failed', 'Could not save your new avatar. Please try again.');
      }
    },
    [updateProfilePicture]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* ── Top Header Row ──────────────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Profile</Text>
          <View style={styles.headerActions}>
            <PressableScale onPress={() => router.push('/community')} hitSlop={8}>
              <Users color={c.textPrimary} size={22} />
            </PressableScale>
            <PressableScale onPress={() => router.push('/settings')} hitSlop={8}>
              <Settings color={c.textPrimary} size={22} />
            </PressableScale>
          </View>
        </View>

        {/* ── Avatar + Name + Edit ─────────────────────────────────────────── */}
        <View style={styles.avatarBlock}>
          <PressableScale onPress={() => setAvatarPickerVisible(true)}>
            {profile?.profile_picture ? (
              <Image source={{ uri: profile.profile_picture }} style={[styles.avatar, { borderColor: c.accentInk }]} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: c.glassFill, borderColor: c.accentInk }]}>
                <Text style={[styles.avatarInitials, { color: c.accentInk }]}>{initials}</Text>
              </View>
            )}
          </PressableScale>
          <Text style={[styles.username, { color: c.textPrimary }]}>
            {profile?.username ?? (isLoadingProfile ? 'Loading…' : 'Guest')}
          </Text>
          {profile?.email ? <Text style={[styles.email, { color: c.textSecondary }]}>{profile.email}</Text> : null}
          <PressableScale style={[styles.editBtn, { borderColor: c.hairline }]} onPress={() => setAvatarPickerVisible(true)}>
            <Text style={[styles.editBtnText, { color: c.textSecondary }]}>EDIT</Text>
          </PressableScale>
        </View>

        {/* ── Social Stats Bar — Shows/Movies only (real data) ──────────────── */}
        <GlassSurface radius={16} style={styles.socialBar}>
          <View style={styles.socialItem}>
            <Text style={[styles.socialCount, monoValueStyle, { color: c.textPrimary }]}>{totalShows}</Text>
            <Text style={[styles.socialLabel, monoLabelStyle, { color: c.textSecondary }]}>Shows</Text>
          </View>
          <View style={[styles.socialDivider, { backgroundColor: c.hairline }]} />
          <View style={styles.socialItem}>
            <Text style={[styles.socialCount, monoValueStyle, { color: c.textPrimary }]}>{totalMovies}</Text>
            <Text style={[styles.socialLabel, monoLabelStyle, { color: c.textSecondary }]}>Movies</Text>
          </View>
        </GlassSurface>

        {/* ── Watch Time Stats Card ─────────────────────────────────────────── */}
        <GlassSurface radius={18} style={[styles.statsCard, { borderColor: c.accentDim }]}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, monoValueStyle, { color: c.accentInk }]}>{watchedMonths}</Text>
            <Text style={[styles.statLabel, monoLabelStyle, { color: c.textSecondary }]}>Months</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.accentDim }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, monoValueStyle, { color: c.accentInk }]}>{remainderDays}</Text>
            <Text style={[styles.statLabel, monoLabelStyle, { color: c.textSecondary }]}>Days</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.accentDim }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, monoValueStyle, { color: c.accentInk }]}>{profile?.watched_hours ?? 0}</Text>
            <Text style={[styles.statLabel, monoLabelStyle, { color: c.textSecondary }]}>Hours</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: c.accentDim }]} />
          <View style={styles.statItem}>
            <Text style={[styles.statValue, monoValueStyle, { color: c.accentInk }]}>{profile?.watched_minutes ?? 0}</Text>
            <Text style={[styles.statLabel, monoLabelStyle, { color: c.textSecondary }]}>Mins</Text>
          </View>
        </GlassSurface>

        {/* ── Shows Section ─────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Shows</Text>
        <PressableScale onPress={() => router.push('/profile/shows' as any)}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Tv2 color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>My Shows</Text>
              <View style={[styles.countBadge, { backgroundColor: c.accentDim, borderColor: c.accentDim }]}>
                <Text style={[styles.countBadgeText, monoValueStyle, { color: c.accentInk }]}>{totalShows}</Text>
              </View>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>

        {/* ── Movies Section ────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Movies</Text>
        <PressableScale onPress={() => router.push('/profile/movies' as any)}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Film color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>My Movies</Text>
              <View style={[styles.countBadge, { backgroundColor: c.accentDim, borderColor: c.accentDim }]}>
                <Text style={[styles.countBadgeText, monoValueStyle, { color: c.accentInk }]}>{totalMovies}</Text>
              </View>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>

        {/* ── Badges ────────────────────────────────────────────────────────── */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Badges</Text>
          <PressableScale onPress={() => router.push('/achievements')} hitSlop={8}>
            <Text style={[styles.seeAll, { color: c.accentInk }]}>See all</Text>
          </PressableScale>
        </View>
        {profile?.earned_badges && profile.earned_badges.length > 0 ? (
          <View style={styles.badgeGrid}>
            {profile.earned_badges.slice(0, 6).map((badgeSlug) => {
              const meta = BADGE_META[badgeSlug] ?? { label: badgeSlug, icon: Trophy, description: '' };
              const BadgeIcon = meta.icon;
              return (
                <GlassSurface key={badgeSlug} radius={14} style={styles.badgeCard}>
                  <View style={[styles.badgeIconCircle, { backgroundColor: c.accentDim }]}>
                    <BadgeIcon color={c.accentInk} size={22} strokeWidth={1.75} />
                  </View>
                  <Text style={[styles.badgeLabel, { color: c.textSecondary }]} numberOfLines={2}>
                    {meta.label}
                  </Text>
                </GlassSurface>
              );
            })}
          </View>
        ) : (
          <GlassSurface radius={14} style={styles.emptyBadges}>
            <Text style={[styles.emptyBadgesText, { color: c.textSecondary }]}>
              No badges yet. Watch episodes to start unlocking achievements.
            </Text>
          </GlassSurface>
        )}

        {/* ── Insights ──────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Insights</Text>
        <PressableScale onPress={() => router.push('/analytics')}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <BarChart2 color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>Analytics</Text>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>
        <PressableScale onPress={() => router.push('/achievements')}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Trophy color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>Achievements</Text>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>
        <PressableScale onPress={() => router.push('/year-review')}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Star color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>Year in Review</Text>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>

        {/* ── Data & Migration ──────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Data & Migration</Text>
        <GlassSurface radius={18} style={styles.migrationCard}>
          <View style={styles.migrationCardHeader}>
            <Text style={[styles.migrationCardTitle, { color: c.textPrimary }]}>Your Data</Text>
            <Text style={[styles.migrationCardSubtitle, { color: c.textSecondary }]}>
              Bring in your watch history from TV Time, or save a backup of your own.
            </Text>
          </View>

          {/* Import button */}
          <PressableScale
            style={[
              styles.migrationBtn,
              { backgroundColor: c.accentFill, borderColor: c.accentFill },
              isImporting && styles.migrationBtnLoading,
            ]}
            onPress={handleImport}
            disabled={isImporting || isExporting}
          >
            {isImporting ? (
              // Once the worker reports a total we can show real progress;
              // until then (upload + enqueue) there is nothing to measure,
              // so fall back to the indeterminate spinner.
              importJob && importJob.total > 0 ? (
                <ProgressRing
                  percentage={importJob.progress * 100}
                  size={18}
                  strokeWidth={2.5}
                  color={c.onAccent}
                  trackColor={c.onAccentTrack}
                  showLabel={false}
                />
              ) : (
                <ActivityIndicator color={c.onAccent} size="small" />
              )
            ) : (
              <Upload color={c.onAccent} size={16} strokeWidth={2.5} />
            )}
            <Text style={[styles.migrationBtnTextDark, { color: c.onAccent }]}>
              {!isImporting
                ? 'Import from TV Time'
                : importJob && importJob.total > 0
                  ? `Importing ${importJob.processed}/${importJob.total}…`
                  : 'Importing…'}
            </Text>
          </PressableScale>

          {/* Export button */}
          <PressableScale
            style={[
              styles.migrationBtn,
              { backgroundColor: 'transparent', borderColor: c.accentDim },
              isExporting && styles.migrationBtnLoading,
            ]}
            onPress={handleExport}
            disabled={isImporting || isExporting}
          >
            {isExporting ? (
              <ActivityIndicator color={c.accentInk} size="small" />
            ) : (
              <Download color={c.accentInk} size={16} strokeWidth={2} />
            )}
            <Text style={[styles.migrationBtnTextLight, { color: c.accentInk }]}>
              {isExporting ? 'Exporting…' : 'Back Up My Data'}
            </Text>
          </PressableScale>
        </GlassSurface>

        {/* ── More ──────────────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>More</Text>
        <PressableScale onPress={() => router.push('/community')}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Users color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>Community</Text>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>
        <PressableScale onPress={() => router.push('/settings')}>
          <GlassSurface radius={14} style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Settings color={c.accentInk} size={18} strokeWidth={1.75} />
              <Text style={[styles.settingsRowText, { color: c.textPrimary }]}>App Settings</Text>
            </View>
            <ChevronRight color={c.textTertiary} size={18} />
          </GlassSurface>
        </PressableScale>

      </ScrollView>

      <AvatarPickerModal
        visible={avatarPickerVisible}
        currentAvatar={profile?.profile_picture ?? null}
        onClose={() => setAvatarPickerVisible(false)}
        onSelect={handleSelectAvatar}
      />

      {/* ── Custom Import Result Modal ────────────────────────────────────── */}
      <Modal visible={importModal.visible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.bgElevated, borderColor: c.hairline }]}>
            <View style={[styles.modalIconContainer, { backgroundColor: c.accentDim }]}>
              {importModal.type === 'success' ? (
                <CheckCircle color={c.accentInk} size={48} strokeWidth={1.5} />
              ) : (
                <XCircle color={c.negative} size={48} strokeWidth={1.5} />
              )}
            </View>
            <Text style={[styles.modalTitle, { color: c.textPrimary }]}>{importModal.title}</Text>
            <Text style={[styles.modalMessage, { color: c.textSecondary }]}>{importModal.message}</Text>

            {importModal.type === 'success' && importModal.stats && (
              <View style={[styles.modalStatsBox, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                <View style={styles.modalStatRow}>
                  <Text style={[styles.modalStatLabel, { color: c.textSecondary }]}>Shows Imported</Text>
                  <Text style={[styles.modalStatValue, { color: c.textPrimary }]}>{importModal.stats.shows}</Text>
                </View>
                <View style={styles.modalStatRow}>
                  <Text style={[styles.modalStatLabel, { color: c.textSecondary }]}>Movies Imported</Text>
                  <Text style={[styles.modalStatValue, { color: c.textPrimary }]}>{importModal.stats.movies}</Text>
                </View>
                <View style={styles.modalStatRow}>
                  <Text style={[styles.modalStatLabel, { color: c.textSecondary }]}>Episodes Marked</Text>
                  <Text style={[styles.modalStatValue, { color: c.accentInk }]}>{importModal.stats.episodes}</Text>
                </View>
                {importModal.stats.errors > 0 && (
                  <View style={[styles.modalStatRow, { marginTop: 12, borderTopWidth: 1, borderTopColor: c.hairline, paddingTop: 12 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <AlertTriangle color={c.negative} size={16} />
                      <Text style={[styles.modalStatLabel, { color: c.negative }]}>Skipped / Not Found</Text>
                    </View>
                    <Text style={[styles.modalStatValue, { color: c.negative }]}>{importModal.stats.errors}</Text>
                  </View>
                )}
              </View>
            )}

            <PressableScale
              style={[styles.modalCloseBtn, { backgroundColor: c.accentFill }]}
              onPress={() => setImportModal((prev) => ({ ...prev, visible: false }))}
            >
              <Text style={[styles.modalCloseText, { color: c.onAccent }]}>Done</Text>
            </PressableScale>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 140, // clears the floating pill tab bar (64 tall + bottom offset)
    gap: 8,
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 18,
  },

  // Avatar block
  avatarBlock: {
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginBottom: 4,
  },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2.5,
  },
  avatarFallback: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 28,
    fontWeight: '900',
  },
  username: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 10,
  },
  email: {
    fontSize: 13,
  },
  editBtn: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  editBtnText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  // Social stats bar
  socialBar: {
    flexDirection: 'row',
    paddingVertical: 14,
    marginVertical: 4,
  },
  socialItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  socialCount: {
    fontSize: 18,
    fontWeight: '800',
  },
  socialLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  socialDivider: {
    width: StyleSheet.hairlineWidth,
  },

  // Stats card (watch time)
  statsCard: {
    flexDirection: 'row',
    paddingVertical: 18,
    marginVertical: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
  },

  // Section headers & rows
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 4,
  },
  seeAll: {
    fontSize: 13,
    fontWeight: '600',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 4,
  },
  settingsRowText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Count badge on rows
  countBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  countBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Badge grid
  badgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 4,
  },
  badgeCard: {
    width: '30%',
    paddingVertical: 14,
    alignItems: 'center',
    gap: 8,
  },
  badgeIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyBadges: {
    padding: 16,
    marginTop: 4,
  },
  emptyBadgesText: {
    fontSize: 13,
    textAlign: 'center',
  },

  // Migration card
  migrationCard: {
    padding: 18,
    gap: 12,
    marginTop: 4,
  },
  migrationCardHeader: {
    gap: 4,
  },
  migrationCardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  migrationCardSubtitle: {
    fontSize: 13,
    lineHeight: 19,
  },
  migrationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  migrationBtnLoading: {
    opacity: 0.6,
  },
  migrationBtnTextDark: {
    fontSize: 14,
    fontWeight: '700',
  },
  migrationBtnTextLight: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    // Matches the app-wide modal-backdrop-scrim convention (CascadeModal,
    // MVPVotingSheet, BadgeUnlockModal) — fixed in both themes by design,
    // was 0.85 here specifically for no documented reason.
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    width: '100%',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalStatsBox: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
  },
  modalStatRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  modalStatLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  modalStatValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  modalCloseBtn: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 100,
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 16,
    fontWeight: '800',
  },
});
