// client-mobile/app/settings.tsx
// Phase 12: Appearance control (System/Light/Dark) writing to themeStore,
// replacing the old static "Ultra Dark — Always on" row. Full theme-token
// migration.

import axios from 'axios';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { ArrowLeft, ChevronRight, LayoutGrid, LogOut, Monitor, Moon, Sun } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AvatarPickerModal from '../components/AvatarPickerModal';
import EditProfileSheet from '../components/EditProfileSheet';
import LogoutConfirmModal from '../components/LogoutConfirmModal';
import PressableScale from '../components/PressableScale';
import { SegmentedControl } from '../components/SegmentedControl';
import { api, API_BASE_URL } from '../lib/api';
import { useAppTheme } from '../lib/theme';
import type { ThemePreference } from '../store/themeStore';
import { LayoutMode, useWatchStore } from '../store/watchStore';

function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.textPrimary }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: c.trackRing, true: c.accentDim }}
        thumbColor={value ? c.accentFill : c.tabInactive}
        ios_backgroundColor={c.trackRing}
      />
    </View>
  );
}

const APPEARANCE_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

const LAYOUT_OPTIONS: { value: LayoutMode; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'grid', label: 'Grid' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const { theme, name, preference, setPreference } = useAppTheme();
  const c = theme.colors;
  const profile = useWatchStore((state) => state.profile);
  const updateProfilePicture = useWatchStore((state) => state.updateProfilePicture);
  const updateUsername = useWatchStore((state) => state.updateUsername);
  const updateIsPrivate = useWatchStore((state) => state.updateIsPrivate);
  const defaultLayout = useWatchStore((state) => state.defaultLayout);
  const setDefaultLayout = useWatchStore((state) => state.setDefaultLayout);
  const [notifyNewEpisode, setNotifyNewEpisode] = useState(true);
  const [notifyWeeklyDigest, setNotifyWeeklyDigest] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [avatarPickerVisible, setAvatarPickerVisible] = useState(false);
  const initials = useMemo(() => {
    if (!profile?.username) return '?';
    return profile.username.slice(0, 2).toUpperCase();
  }, [profile?.username]);
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/notifications/preferences/');
        setNotifyNewEpisode(res.data.notify_new_episode);
        setNotifyWeeklyDigest(res.data.notify_weekly_digest);
      } catch (error) {
        console.warn('Failed to fetch notification preferences', error);
      }
    })();
  }, []);

  const handleToggleNewEpisode = async (next: boolean) => {
    setNotifyNewEpisode(next);
    await api.patch('/notifications/preferences/', { notify_new_episode: next }).catch(() => {});
  };

  const handleToggleWeeklyDigest = async (next: boolean) => {
    setNotifyWeeklyDigest(next);
    await api.patch('/notifications/preferences/', { notify_weekly_digest: next }).catch(() => {});
  };

  const performLogout = async () => {
    setIsLogoutModalVisible(false);
    setIsLoggingOut(true);
    try {
      const refreshToken = await SecureStore.getItemAsync('refresh_token');
      if (refreshToken) {
        await axios
          .post(`${API_BASE_URL}/auth/logout/`, { refresh: refreshToken })
          .catch(() => undefined);
      }
    } finally {
      await SecureStore.deleteItemAsync('access_token');
      await SecureStore.deleteItemAsync('refresh_token');
      // Otherwise the home-screen widgets keep showing this account's
      // watchlist to whoever uses the device next.
      await useWatchStore.getState().clearWidgetData();
      setIsLoggingOut(false);
      router.replace('/login');
    }
  };

  const handleLogout = () => {
    setIsLogoutModalVisible(true);
  };

  const AppearanceIcon = preference === 'system' ? Monitor : preference === 'light' ? Sun : Moon;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]} edges={['top']}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Notifications</Text>
        <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <SwitchRow
            label="New episode alerts"
            value={notifyNewEpisode}
            onValueChange={handleToggleNewEpisode}
          />
          <View style={[styles.divider, { backgroundColor: c.hairline }]} />
          <SwitchRow
            label="Weekly digest"
            value={notifyWeeklyDigest}
            onValueChange={handleToggleWeeklyDigest}
          />
        </View>

        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Appearance</Text>
        <View style={[styles.card, styles.appearanceCard, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <View style={styles.appearanceLabelRow}>
            <AppearanceIcon color={c.accentInk} size={16} />
            <Text style={[styles.rowLabel, { color: c.textPrimary }]}>
              {preference === 'system' ? `System (currently ${name})` : preference === 'light' ? 'Light' : 'Dark'}
            </Text>
          </View>
          <SegmentedControl
            segments={APPEARANCE_OPTIONS}
            selectedValue={preference}
            onValueChange={setPreference}
          />
          <Text style={[styles.appearanceHint, { color: c.textTertiary }]}>
            System follows your phone's appearance and updates live if it changes.
          </Text>

          <View style={[styles.appearanceLabelRow, styles.defaultLayoutLabelRow]}>
            <LayoutGrid color={c.accentInk} size={16} />
            <Text style={[styles.rowLabel, { color: c.textPrimary }]}>Default layout</Text>
          </View>
          <SegmentedControl
            segments={LAYOUT_OPTIONS}
            selectedValue={defaultLayout}
            onValueChange={setDefaultLayout}
          />
          <Text style={[styles.appearanceHint, { color: c.textTertiary }]}>
            Applies to Shows, Movies, and every My Shows/My Movies/My Anime list. A screen you've
            switched manually keeps its own choice until you change this again.
          </Text>
        </View>

        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <PressableScale style={styles.row} onPress={() => setEditProfileVisible(true)}>
            <Text style={[styles.rowLabel, { color: c.textPrimary }]}>Username</Text>
            <View style={styles.rowValueGroup}>
              <Text style={[styles.rowValue, { color: c.textSecondary }]}>{profile?.username ?? '—'}</Text>
              <ChevronRight color={c.textTertiary} size={16} />
            </View>
          </PressableScale>
          <View style={[styles.divider, { backgroundColor: c.hairline }]} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: c.textPrimary }]}>Email</Text>
            <Text style={[styles.rowValue, { color: c.textSecondary }]}>{profile?.email || '—'}</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: c.textSecondary }]}>Privacy</Text>
        <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <SwitchRow
            label="Private account"
            value={profile?.is_private ?? false}
            onValueChange={(next) => {
              updateIsPrivate(next).then((ok) => {
                if (!ok) Alert.alert('Update Failed', 'Could not change your privacy setting. Please try again.');
              });
            }}
          />
          <Text style={[styles.privacyHint, { color: c.textTertiary }]}>
            Hides you from search, activity feeds, and everyone else's view of your profile.
          </Text>
        </View>

        <PressableScale
          style={[
            styles.logoutButton,
            { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' },
          ]}
          onPress={handleLogout}
          disabled={isLoggingOut}
        >
          <LogOut color={c.negative} size={18} />
          <Text style={[styles.logoutText, { color: c.negative }]}>
            {isLoggingOut ? 'Logging out…' : 'Log Out'}
          </Text>
        </PressableScale>
      </ScrollView>

      <LogoutConfirmModal
        visible={isLogoutModalVisible}
        onConfirm={performLogout}
        onCancel={() => setIsLogoutModalVisible(false)}
      />

      <EditProfileSheet
        visible={editProfileVisible}
        username={profile?.username ?? ''}
        avatarUrl={profile?.profile_picture ?? null}
        avatarInitials={initials}
        onClose={() => setEditProfileVisible(false)}
        onChangePhoto={() => {
          setEditProfileVisible(false);
          setAvatarPickerVisible(true);
        }}
        onSaveUsername={updateUsername}
      />

      <AvatarPickerModal
        visible={avatarPickerVisible}
        currentAvatar={profile?.profile_picture ?? null}
        onClose={() => setAvatarPickerVisible(false)}
        onSelect={async (url) => {
          setAvatarPickerVisible(false);
          const ok = await updateProfilePicture(url);
          if (!ok) {
            Alert.alert('Update Failed', 'Could not save your new avatar. Please try again.');
          }
        }}
      />
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
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 10,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 18,
    marginBottom: 4,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    overflow: 'hidden',
  },
  appearanceCard: {
    padding: 14,
    gap: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 16,
  },
  rowLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: 14,
  },
  rowValueGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  appearanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  defaultLayoutLabelRow: {
    marginTop: 4,
  },
  appearanceHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  privacyHint: {
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 16,
    paddingBottom: 14,
    marginTop: -6,
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 28,
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
