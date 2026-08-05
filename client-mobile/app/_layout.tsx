// client-mobile/app/_layout.tsx
import { ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as Updates from 'expo-updates';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, InteractionManager, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BadgeUnlockModal } from '../components/BadgeUnlockModal';
import CompletionCelebration from '../components/CompletionCelebration';
import ErrorBoundary from '../components/ErrorBoundary';
import { api, getAccessToken, setSessionExpiredHandler } from '../lib/api';
import { BADGE_META } from '../lib/badges';
import { registerForPushNotificationsAsync } from '../lib/notifications';
import { flushPersist } from '../lib/persistStorage';
import { pingHealth } from '../lib/warmup';
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

// Fire the instant the JS bundle evaluates — a Render free-tier dyno's cold
// boot (20-50s) starts the moment any request reaches it, so pinging here
// (overlapping with font load and the local SecureStore auth check below,
// both of which take real time on their own) buys back several seconds of
// wake time before app/loading.tsx's own waitForBackend() starts polling.
// Fire-and-forget: nothing downstream awaits this specific call.
pingHealth(4000).catch(() => {});

// Phase 83 perf: these four useWatchStore selectors used to live directly in
// RootLayoutInner. Two are stable action refs (no re-render on their own),
// but unlockedBadges/completedShow are real state — a badge unlock or a
// series-finished celebration re-rendered RootLayoutInner itself, which
// re-created the entire <Stack> below (30 <Stack.Screen> elements) just to
// flip a modal's `visible` prop. Split into its own sibling component so
// that re-render is scoped to these two small modals, not the navigator.
function GlobalOverlays() {
  const unlockedBadges = useWatchStore((s) => s.unlockedBadges);
  const popUnlockedBadge = useWatchStore((s) => s.popUnlockedBadge);
  const completedShow = useWatchStore((s) => s.completedShow);
  const clearCompletedShow = useWatchStore((s) => s.clearCompletedShow);

  return (
    <>
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
      <CompletionCelebration
        visible={completedShow !== null}
        title={completedShow?.title ?? ''}
        posterPath={completedShow?.posterPath ?? null}
        onDismiss={clearCompletedShow}
      />
    </>
  );
}

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

  // "Akony" wordmark font (Phase J) — no custom font asset was loaded
  // anywhere in this app before this phase, so this is genuinely new
  // infrastructure, not a one-line style tweak. Gated the same way as the
  // auth check below: native splash stays up (and the Stack stays
  // unmounted) until this resolves, so the login screen's first paint
  // never flashes the system font before Akony pops in.
  const [fontsLoaded, fontError] = useFonts({
    Akony: require('../assets/fonts/AKONY.ttf'),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        // getAccessToken() (lib/api.ts) carries its own 2s timeout — same
        // guard this used to inline directly, because SecureStore can
        // sometimes hang indefinitely on Android Expo Go — and doubles as
        // this session's cache-priming read, so every request interceptor
        // call after this one is free.
        const token = await getAccessToken();

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
        // Bug fix (user-reported "sometimes automatically logged out"): this
        // catch fires on a genuine SecureStore error OR simply when the
        // 2-second timeout above wins the race — the comment on that race
        // already documents that SecureStore can be slow to hang on
        // Android/Expo Go, and a slow read is not proof the user is logged
        // out. Forcing isAuthenticated=false here redirected a genuinely
        // logged-in user straight to /login despite their tokens sitting
        // untouched in SecureStore. Optimistically staying "authenticated"
        // is safe either way: if there really is no token, the very first
        // API call 401s and lib/api.ts's own refresh flow finds no refresh
        // token either, which correctly bounces to /login one round-trip
        // later instead of on a false positive here.
        console.error('Error during auth check:', error);
        if (isMounted) setIsAuthenticated(true);
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

  useEffect(() => {
    // Default expo-updates behavior only applies a fetched OTA bundle on
    // the *next* cold launch, so a published update silently needed two
    // full app kills before it was visible. Checking + fetching + reloading
    // here collapses that to one relaunch. Updates.isEnabled is false in
    // Expo Go / dev client, so this is a no-op there.
    if (__DEV__ || !Updates.isEnabled) return;
    // Phase 83 perf: this used to fire immediately at launch, competing on
    // a cold network with the boot-critical fetches (auth check, first
    // watchlist/profile load) for the same limited bandwidth/backend
    // capacity. The update check is never boot-critical — deferred past
    // the initial interaction burst (InteractionManager) plus a short fixed
    // delay so it lands well after those requests are underway.
    const task = InteractionManager.runAfterInteractions(() => {
      setTimeout(() => {
        (async () => {
          try {
            const result = await Updates.checkForUpdateAsync();
            if (result.isAvailable) {
              await Updates.fetchUpdateAsync();
              await Updates.reloadAsync();
            }
          } catch {
            // best-effort — app just continues on the bundle it already has
          }
        })();
      }, 3000);
    });
    return () => task.cancel();
  }, []);

  useEffect(() => {
    // The widget is only ever written to by explicit in-app actions
    // (fetchWatchlist/toggle/add — store/watchStore.ts). Those are mostly
    // fire-and-forget (Phase 37's latency fix), so if the user backgrounds
    // the app right after marking something watched, the write can lose
    // the race against the process being suspended, leaving the widget
    // stale until some other action happens to resync it. Proactively
    // resyncing from whatever's already in memory the moment the app
    // actually leaves the foreground closes that gap — no network call,
    // just flushes current store state to the widget one more time before
    // the OS potentially suspends the process. Gated on auth so a
    // logged-out background doesn't push stale/empty pre-login state.
    if (!isAuthenticated) return;
    // Also flush once on mount: the persisted store is rehydrated by now, so
    // even a cold start with the backend unreachable pushes the last known
    // watchlist to the widget instead of leaving whatever it had.
    try {
      useWatchStore.getState().syncWidgetData();
    } catch {
      // best-effort, same reasoning as the background flush below
    }
    let previousAppState = AppState.currentState;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = previousAppState === 'background';
      previousAppState = nextState;

      if (nextState === 'background') {
        try {
          useWatchStore.getState().syncWidgetData();
        } catch {
          // best-effort — a stale widget for one background cycle self-heals
          // via Android's own periodic redraw or the next in-app action.
        }
        // Any debounced watchStore write still pending gets forced out now —
        // otherwise a suspend before the timer fires drops the last mutation.
        flushPersist();
      }

      // Phase 77: a backgrounded app can sit long enough (16+ minutes) for
      // Render's free-tier dyno to go cold again without the user ever
      // force-quitting — the exact scenario the module-load ping at the top
      // of this file exists for, just re-armed for "resumed" instead of
      // "freshly launched". Fire-and-forget, same as that one: nothing here
      // gates the screen the user lands back on. Guarded on the actual
      // background->active edge (not every inactive<->active blip, e.g. iOS
      // Control Center) via the tracked previous state above.
      if (wasBackground && nextState === 'active') {
        pingHealth(4000).catch(() => {});
      }
    });
    return () => subscription.remove();
  }, [isAuthenticated]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <SafeAreaProvider>
        <ThemeProvider value={toNavigationTheme(theme)}>
          <StatusBar style={theme.statusBar} />
          {!isAuthChecked || (!fontsLoaded && !fontError) ? (
            <View style={[styles.bootLoader, { backgroundColor: theme.colors.bg }]}>
              <ActivityIndicator color={theme.colors.accentInk} size="large" />
            </View>
          ) : (
            <ErrorBoundary>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.bg },
                animation: 'fade',
                freezeOnBlur: true,
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
                name="profile/reviews"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              {/* Phase 75.2 added the route file but never registered it here,
                  so it fell back to the Stack's default `animation: 'fade'`
                  while every sibling profile destination slides. Cosmetic
                  only — expo-router registers the route from the filesystem
                  regardless — but it made My Anime feel like a different
                  kind of navigation than My Shows / My Movies. */}
              <Stack.Screen
                name="profile/anime"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="movie/[id]"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="lists/index"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="lists/[id]"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="user/[username]"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
              <Stack.Screen
                name="user/[username]/connections"
                options={{ headerShown: false, animation: 'slide_from_right' }}
              />
            </Stack>
            </ErrorBoundary>
          )}
          <GlobalOverlays />
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