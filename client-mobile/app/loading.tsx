// client-mobile/app/loading.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AnimatedSplash from '../components/AnimatedSplash';
import { useWatchStore } from '../store/watchStore';

export default function LoadingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const fetchWatchlist = useWatchStore((state) => state.fetchWatchlist);
  const fetchProfile = useWatchStore((state) => state.fetchProfile);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    (async () => {
      await Promise.all([fetchProfile(), fetchWatchlist()]);
      if (isMounted) setReady(true);
    })();

    return () => {
      isMounted = false;
    };
  }, [fetchProfile, fetchWatchlist]);

  return (
    <SafeAreaView style={styles.container}>
      <AnimatedSplash
        ready={ready}
        onExitComplete={() => {
          const destination = typeof params.next === 'string' ? params.next : '/(tabs)';
          router.replace(destination as never);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
