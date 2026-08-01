// client-mobile/app/user/[username].tsx
// Public profile screen (Phase 74) — GET /users/<username>/. A private
// account or a nonexistent username both 404 identically server-side
// (core/social_views.py), so this screen shows one generic message for
// both rather than trying to distinguish them.

import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Clapperboard, ListChecks, Tv } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ErrorState from '../../components/ErrorState';
import FollowButton from '../../components/FollowButton';
import GlassSurface from '../../components/GlassSurface';
import PressableScale from '../../components/PressableScale';
import { useAppTheme } from '../../lib/theme';
import { monoLabelStyle, monoValueStyle } from '../../lib/typography';
import { useSocialStore } from '../../store/socialStore';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

function memberSince(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function PublicProfileScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const { username } = useLocalSearchParams<{ username: string }>();

  const profiles = useSocialStore((s) => s.profiles);
  const isLoadingProfile = useSocialStore((s) => s.isLoadingProfile);
  const error = useSocialStore((s) => s.error);
  const fetchProfile = useSocialStore((s) => s.fetchProfile);

  const profile = username ? profiles[username.toLowerCase()] : undefined;

  useEffect(() => {
    if (username) fetchProfile(username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const initials = profile?.username ? profile.username.slice(0, 2).toUpperCase() : '?';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.iconButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]} numberOfLines={1}>
          {profile?.username ?? username}
        </Text>
        <View style={styles.iconButton} />
      </View>

      {isLoadingProfile && !profile ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : !profile ? (
        <ErrorState
          message={error ?? 'This profile is private or doesn’t exist.'}
          onRetry={() => username && fetchProfile(username)}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.avatarBlock}>
            {profile.profile_picture ? (
              <Image source={{ uri: profile.profile_picture }} style={[styles.avatar, { borderColor: c.accentInk }]} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: c.glassFill, borderColor: c.accentInk }]}>
                <Text style={[styles.avatarInitials, { color: c.accentInk }]}>{initials}</Text>
              </View>
            )}
            <Text style={[styles.username, { color: c.textPrimary }]}>{profile.username}</Text>
            <Text style={[styles.memberSince, { color: c.textSecondary }]}>
              Member since {memberSince(profile.member_since)}
            </Text>

            <View style={styles.followRow}>
              {!profile.is_self && <FollowButton username={profile.username} isFollowing={profile.is_following} />}
              {profile.follows_you && (
                <View style={[styles.followsYouPill, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
                  <Text style={[styles.followsYouText, { color: c.textSecondary }]}>Follows you</Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Followers / Following ─────────────────────────────────────── */}
          <GlassSurface radius={16} style={styles.socialBar}>
            <PressableScale
              style={styles.socialItem}
              onPress={() => router.push(`/user/${profile.username}/connections?tab=followers` as any)}
            >
              <Text style={[styles.socialCount, monoValueStyle, { color: c.textPrimary }]}>{profile.follower_count}</Text>
              <Text style={[styles.socialLabel, monoLabelStyle, { color: c.textSecondary }]}>Followers</Text>
            </PressableScale>
            <View style={[styles.socialDivider, { backgroundColor: c.hairline }]} />
            <PressableScale
              style={styles.socialItem}
              onPress={() => router.push(`/user/${profile.username}/connections?tab=following` as any)}
            >
              <Text style={[styles.socialCount, monoValueStyle, { color: c.textPrimary }]}>{profile.following_count}</Text>
              <Text style={[styles.socialLabel, monoLabelStyle, { color: c.textSecondary }]}>Following</Text>
            </PressableScale>
          </GlassSurface>

          {/* ── Watch stats ────────────────────────────────────────────────── */}
          <View style={styles.statsGrid}>
            <GlassSurface radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, { color: c.accentInk }]}>{profile.shows_tracked}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Shows</Text>
            </GlassSurface>
            <GlassSurface radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, { color: c.accentInk }]}>{profile.movies_watched}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Movies</Text>
            </GlassSurface>
            <GlassSurface radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, { color: c.accentInk }]}>{profile.episodes_watched}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Episodes</Text>
            </GlassSurface>
            <GlassSurface radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, { color: c.accentInk }]}>{profile.watched_hours}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Hours</Text>
            </GlassSurface>
            <GlassSurface radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, { color: c.accentInk }]}>{profile.current_streak}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Streak</Text>
            </GlassSurface>
            <GlassSurface radius={14} style={styles.statCard}>
              <Text style={[styles.statValue, { color: c.accentInk }]}>{profile.earned_badges.length}</Text>
              <Text style={[styles.statLabel, { color: c.textSecondary }]}>Badges</Text>
            </GlassSurface>
          </View>

          {/* ── Top Shows ──────────────────────────────────────────────────── */}
          {profile.top_shows.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Top Shows</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.posterRow}>
                {profile.top_shows.map((show) => (
                  <PressableScale
                    key={show.tmdb_id}
                    style={styles.posterCard}
                    onPress={() => router.push(`/show/${show.tmdb_id}` as any)}
                  >
                    {show.poster_path ? (
                      <Image
                        source={{ uri: `${POSTER_BASE_URL}${show.poster_path}` }}
                        style={[styles.poster, { backgroundColor: c.bgElevated }]}
                      />
                    ) : (
                      <View style={[styles.posterFallback, { backgroundColor: c.bgElevated }]}>
                        <Tv color={c.textTertiary} size={20} strokeWidth={1.75} />
                      </View>
                    )}
                    <Text style={[styles.posterCaption, { color: c.textSecondary }]} numberOfLines={1}>
                      {show.episodes_watched} ep{show.episodes_watched === 1 ? '' : 's'}
                    </Text>
                  </PressableScale>
                ))}
              </ScrollView>
            </>
          )}

          {/* ── Recent Movies ──────────────────────────────────────────────── */}
          {profile.recent_movies.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Recent Movies</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.posterRow}>
                {profile.recent_movies.map((movie) => (
                  <PressableScale
                    key={movie.tmdb_id}
                    style={styles.posterCard}
                    onPress={() => router.push(`/movie/${movie.tmdb_id}` as any)}
                  >
                    {movie.poster_path ? (
                      <Image
                        source={{ uri: `${POSTER_BASE_URL}${movie.poster_path}` }}
                        style={[styles.poster, { backgroundColor: c.bgElevated }]}
                      />
                    ) : (
                      <View style={[styles.posterFallback, { backgroundColor: c.bgElevated }]}>
                        <Clapperboard color={c.textTertiary} size={20} strokeWidth={1.75} />
                      </View>
                    )}
                  </PressableScale>
                ))}
              </ScrollView>
            </>
          )}

          {/* ── Public Lists ───────────────────────────────────────────────── */}
          {profile.public_lists.length > 0 && (
            <>
              <Text style={[styles.sectionTitle, { color: c.textPrimary }]}>Lists</Text>
              {profile.public_lists.map((list) => (
                <PressableScale key={list.id} onPress={() => router.push(`/lists/${list.id}` as any)}>
                  <GlassSurface radius={14} style={styles.listRow}>
                    <View style={styles.listRowLeft}>
                      <ListChecks color={c.accentInk} size={16} strokeWidth={1.75} />
                      <Text style={[styles.listName, { color: c.textPrimary }]} numberOfLines={1}>
                        {list.name}
                      </Text>
                    </View>
                    <Text style={[styles.listCount, { color: c.textTertiary }]}>{list.item_count}</Text>
                  </GlassSurface>
                </PressableScale>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 60,
    gap: 8,
  },
  avatarBlock: {
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
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
  memberSince: {
    fontSize: 12,
  },
  followRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  followsYouPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  followsYouText: {
    fontSize: 11,
    fontWeight: '700',
  },
  socialBar: {
    flexDirection: 'row',
    paddingVertical: 14,
    marginTop: 12,
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  statCard: {
    width: '31%',
    paddingVertical: 14,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 4,
  },
  posterRow: {
    gap: 10,
    paddingVertical: 4,
  },
  posterCard: {
    width: 72,
    gap: 4,
  },
  poster: {
    width: 72,
    height: 104,
    borderRadius: 8,
  },
  posterFallback: {
    width: 72,
    height: 104,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterCaption: {
    fontSize: 10,
    textAlign: 'center',
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 6,
  },
  listRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  listName: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  listCount: {
    fontSize: 12,
    fontWeight: '600',
  },
});
