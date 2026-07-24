// client-mobile/components/CompletionCelebration.tsx
// Phase 67 — confetti burst + banner shown once when a show's final episode
// is marked watched and the show has fully aired/ended (see
// watchStore.ts's `completedShow` — this component only ever renders in
// response to that state, never computes the trigger itself).
//
// Reuses this repo's existing animation primitive (Reanimated — same as
// BadgeUnlockModal/CascadeModal/AnimatedSplash) rather than adding Lottie
// or any other new dependency. Deliberately NOT a blocking full-screen
// modal like BadgeUnlockModal: this is a non-blocking banner (same
// `pointerEvents="box-none"` + auto-dismiss-timer convention as
// Snackbar.tsx) so a user who just finished a series isn't trapped on the
// screen — it fades away on its own, or a tap dismisses it early.
//
// Confetti palette stays inside the locked design system rather than
// introducing new hues: c.accentFill (brand yellow), c.textPrimary (a
// theme-resolved neutral — white in dark, near-black in light; a literal
// '#FFFFFF' would be nearly invisible against the light theme's pale
// #EDEEEA background, so this can't reuse the fixed-white "photo caption"
// exception other components use — there's no photo underneath this,
// just the screen's own themed background), and c.negative for a small
// pop of contrast — no arbitrary rainbow palette.

import { Image } from 'expo-image';
import { PartyPopper } from 'lucide-react-native';
import React, { useEffect, useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const POSTER_BASE = 'https://image.tmdb.org/t/p/w92';
const PARTICLE_COUNT = 28;
const AUTO_DISMISS_MS = 4200;

interface Props {
  visible: boolean;
  title: string;
  posterPath: string | null;
  onDismiss: () => void;
}

interface ParticleConfig {
  key: number;
  startX: number;
  drift: number;
  fallTo: number;
  duration: number;
  delay: number;
  size: number;
  color: string;
}

function ConfettiParticle({ config }: { config: ParticleConfig }) {
  const translateY = useSharedValue(-24);
  const translateX = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withDelay(
      config.delay,
      withTiming(config.fallTo, { duration: config.duration, easing: Easing.in(Easing.quad) })
    );
    translateX.value = withDelay(config.delay, withTiming(config.drift, { duration: config.duration }));
    rotate.value = withDelay(config.delay, withTiming(520, { duration: config.duration }));
    opacity.value = withDelay(config.delay + config.duration - 500, withTiming(0, { duration: 500 }));
    // Runs once per mount — each ConfettiParticle is only ever mounted for
    // one burst (the parent regenerates config/keys per celebration).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: config.startX + translateX.value },
      { translateY: translateY.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        styles.particle,
        { backgroundColor: config.color, width: config.size, height: config.size * 0.4 },
        style,
      ]}
    />
  );
}

export default function CompletionCelebration({ visible, title, posterPath, onDismiss }: Props) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const cardY = useSharedValue(-120);
  const cardOpacity = useSharedValue(0);

  // Fresh randomized burst each time a new celebration starts — keyed on
  // `title` (a genuinely different completion changes the key; the exact
  // same show can't complete twice, so this never needs a separate counter).
  const particles = useMemo<ParticleConfig[]>(() => {
    if (!visible) return [];
    const palette = [c.accentFill, c.textPrimary, c.negative];
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
      key: i,
      startX: Math.random() * SCREEN_WIDTH,
      drift: (Math.random() - 0.5) * 140,
      fallTo: 520 + Math.random() * 260,
      duration: 1700 + Math.random() * 1100,
      delay: Math.random() * 300,
      size: 6 + Math.random() * 7,
      color: palette[i % palette.length],
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }));
  }, [visible, title]);

  useEffect(() => {
    if (!visible) return;
    cardY.value = withTiming(0, { duration: 420, easing: Easing.out(Easing.cubic) });
    cardOpacity.value = withTiming(1, { duration: 300 });
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
    // Same convention as Snackbar.tsx: re-arm only on visible/title change,
    // not on every onDismiss identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, title]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: cardY.value }],
    opacity: cardOpacity.value,
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Confetti layer — purely decorative, never intercepts touches. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {particles.map((p) => (
          <ConfettiParticle key={p.key} config={p} />
        ))}
      </View>

      {/* Banner — non-blocking (Snackbar's pointerEvents/auto-dismiss
          convention), not a full-screen modal like BadgeUnlockModal, so
          finishing a series doesn't trap the user on this screen. */}
      <Animated.View style={[styles.cardWrap, cardStyle]} pointerEvents="box-none">
        <PressableScale
          style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
          onPress={onDismiss}
        >
          {posterPath ? (
            <Image
              source={{ uri: `${POSTER_BASE}${posterPath}` }}
              style={[styles.poster, { backgroundColor: c.bgElevated }]}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.poster, styles.posterFallback, { backgroundColor: c.accentDim }]}>
              <PartyPopper color={c.accentInk} size={20} />
            </View>
          )}
          <View style={styles.cardText}>
            <Text style={[styles.cardTitle, { color: c.accentInk }]}>Series Complete!</Text>
            <Text style={[styles.cardSubtitle, { color: c.textPrimary }]} numberOfLines={2}>
              You finished {title}
            </Text>
          </View>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 2,
  },
  cardWrap: {
    position: 'absolute',
    top: 56,
    left: 16,
    right: 16,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 8,
  },
  poster: {
    width: 40,
    height: 56,
    borderRadius: 8,
  },
  posterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardText: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  cardSubtitle: {
    fontSize: 14,
    fontWeight: '700',
  },
});
