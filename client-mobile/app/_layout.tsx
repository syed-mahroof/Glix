// client-mobile/app/_layout.tsx
import { ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BadgeUnlockModal } from '../components/BadgeUnlockModal';
import { ACCESS_TOKEN_KEY, api, setSessionExpiredHandler } from '../lib/api';
import { BADGE_META } from '../lib/badges';
import { registerForPushNotificationsAsync } from '../lib/notifications';
import { AppThemeProvider, useAppTheme, toNavigationTheme } from '../lib/theme';
import { useWatchStore } from '../store/watchStore';
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from '../widgets/android/WidgetProvider';

if (Platform.OS === 'android') {
  try {
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch (e) {}
}

// Native splash (flat black, see app.json) stays up until the JS tree has
// painted its first frame -- avoids a blank flash between the native splash
// disappearing and RootLayoutInner's boot loader appearing.
SplashScreen.preventAutoHideAsync().catch(() => {});

// The whole tree is wrapped in AppThemeProvider so every screen can read the
// resolved theme via useAppTheme(). The actual layout lives in RootLayoutInner
// so it can consume the theme (backgrounds, StatusBar, navigation theme).
export default function RootLayout() {
  return (
    <AppThemeProvider>
      <RootLayoutInner />
    </AppThemeProvider>
  );
}

function RootLayoutInner() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const [isAuthChecked, setIsAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const { unlockedBadges, popUnlockedBadge } = useWatchStore();

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        // Add a 2-second timeout because SecureStore can sometimes hang indefinitely on Android Expo Go
        const token = await Promise.race([
          SecureStore.getItemAsync(ACCESS_TOKEN_KEY),
          new Promise<null>((_, reject) => setTimeout(() => reject(new Error('SecureStore timeout')), 2000))
        ]);

        if (!isMounted) return;
        
        if (!token) {
          setIsAuthenticated(false);
        } else {
          setIsAuthenticated(true);
          // Sync push token if authenticated
          registerForPushNotificationsAsync().then((pushToken) => {
            if (pushToken) {
              api.patch('/notifications/preferences/', { push_token: pushToken }).catch(() => {});
            }
          });
        }
      } catch (error) {
        console.error('Error during auth check:', error);
        if (isMounted) setIsAuthenticated(false);
      } finally {
        if (isMounted) setIsAuthChecked(true);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (isAuthChecked) {
      if (!isAuthenticated) {
        router.replace('/login');
      }
    }
  }, [isAuthChecked, isAuthenticated, router]);

  useEffect(() => {
    // A definitive refresh-token failure (lib/api.ts) redirects here
    // instead of leaving the user stuck on a screen full of 401s.
    setSessionExpiredHandler(() => router.replace('/login'));
    return () => setSessionExpiredHandler(null);
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={toNavigationTheme(theme)}>
          <StatusBar style={theme.statusBar} />
          {!isAuthChecked ? (
            <View style={[styles.bootLoader, { backgroundColor: theme.colors.bg }]}>
              <ActivityIndicator color={theme.colors.accentInk} size="large" />
            </View>
          ) : (
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.bg },
                animation: 'fade',
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
              <Stack.Screen
                name="register"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="onboarding"
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen
                name="loading"
                options={{ headerShown: false, gestureEnabled: false }}
              />
              <Stack.Screen
                name="search"
                options={{ headerShown: false, presentation: 'modal' }}
              />
              <Stack.Screen name="settings" options={{ headerShown: false }} />
              <Stack.Screen
                name="show/[id]"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="show/[id]/comments"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="community"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="analytics"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="statistics"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="achievements"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="year-review"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="profile/shows"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="profile/movies"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="movie/[id]"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
            </Stack>
          )}
          <BadgeUnlockModal
            visible={unlockedBadges.length > 0}
            badgeName={
              unlockedBadges[0]
                ? BADGE_META[unlockedBadges[0]]?.label ?? unlockedBadges[0].replace(/_/g, ' ')
                : 'New Badge'
            }
            badgeDescription={
              unlockedBadges[0]
                ? BADGE_META[unlockedBadges[0]]?.description ?? "You've earned a new achievement!"
                : "You've earned a new achievement!"
            }
            onClose={popUnlockedBadge}
          />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  bootLoader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});