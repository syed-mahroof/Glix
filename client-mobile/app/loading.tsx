// client-mobile/app/loading.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AnimatedSplash from '../components/AnimatedSplash';
import PressableScale from '../components/PressableScale';
import { waitForBackend } from '../lib/warmup';
import { useWatchStore } from '../store/watchStore';

type BootStatus = 'connecting' | 'waking' | 'error';

export default function LoadingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const fetchWatchlist = useWatchStore((state) => state.fetchWatchlist);
  const fetchProfile = useWatchStore((state) => state.fetchProfile);
  const clearError = useWatchStore((state) => state.clearError);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<BootStatus>('connecting');
  const [attempt, setAttempt] = useState(0);

  const run = useCallback(async () => {
    setStatus('connecting');
    setReady(false);
    clearError();

    // Cold-start-aware wake: waits out a sleeping Render free-tier dyno
    // (20-50s boot) with its own bounded, cheap health-ping loop instead of
    // relying on the normal per-request retry budget (lib/api.ts), which is
    // tuned for TMDB blips, not a multi-second dyno boot, and was exhausting
    // before the dyno woke up. onSlowWake only fires past ~3s, so a warm
    // backend (the common case) never shows this at all.
    const { awake } = await waitForBackend(() => setStatus('waking'));

    if (!awake) {
      setStatus('error');
      return;
    }

    setStatus('connecting');
    await Promise.all([fetchProfile(), fetchWatchlist()]);

    // fetchProfile/fetchWatchlist swallow their own request errors into
    // store.error and always resolve (never reject) — previously this meant
    // `ready` flipped true unconditionally, landing the user in the app
    // already showing a permanent "Can't reach Glix" banner instead of a
    // real retry affordance. Checking the store's error after the fact
    // turns that same failure into an actual error state here.
    if (useWatchStore.getState().error) {
      setStatus('error');
      return;
    }

    setReady(true);
  }, [fetchProfile, fetchWatchlist, clearError]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      await run();
      if (!isMounted) return;
    })();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const statusText =
    status === 'waking'
      ? 'Waking up the server — this can take up to a minute.'
      : status === 'error'
        ? "Can't reach Glix right now. Check your connection."
        : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedSplash
        ready={ready}
        statusText={statusText}
        onExitComplete={() => {
          const destination = typeof params.next === 'string' ? params.next : '/(tabs)';
          router.replace(destination as never);
        }}
      />
      {status === 'error' && (
        <PressableScale
          onPress={() => setAttempt((n) => n + 1)}
          style={styles.retryButton}
          accessibilityRole="button"
          accessibilityLabel="Retry connecting to Glix"
        >
          <Text style={styles.retryText}>Retry</Text>
        </PressableScale>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  retryButton: {
    position: 'absolute',
    bottom: 64,
    alignSelf: 'center',
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#E4FA1A',
  },
  retryText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 15,
  },
});
