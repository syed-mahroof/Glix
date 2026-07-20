// client-mobile/components/AnimatedSplash.tsx
// Full-screen animated splash overlay for Glix (Phase 32). Wired into
// app/loading.tsx in place of the previous static wordmark + spinner.
// Choreography: glass disc fade-in -> neon ring draws itself clockwise ->
// core ignites with a spring bounce -> wordmark letters rise in, staggered ->
// slow glow-breathing loop while waiting on `ready` -> scale+fade exit.
//
// Design tokens below are intentionally hardcoded, not pulled from
// lib/theme.ts -- the splash must look identical regardless of the user's
// persisted light/dark theme preference (see AI_RULES.md section 2a).

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  Easing,
  runOnJS,
  useReducedMotion,
  SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

const BG = '#000000';
const ACCENT = '#E4FA1A'; // Cinema Neon Yellow
const GLASS = 'rgba(30,30,30,0.65)';
const HAIRLINE = 'rgba(255,255,255,0.12)';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const RING_SIZE = 176;
const RING_STROKE = 2;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const DISC_SIZE = RING_SIZE + 44;

const WORDMARK = ['G', 'L', 'I', 'X'];
const MIN_DISPLAY_MS = 1400; // floor so a fast prefetch never causes a jarring flash
const EXIT_DURATION_MS = 380;

type Props = {
  /** Flip to true once the existing auth/prefetch gate (loading.tsx) has resolved. */
  ready: boolean;
  /** Called after the exit animation finishes -- unmount this overlay / navigate here. */
  onExitComplete: () => void;
};

export default function AnimatedSplash({ ready, onExitComplete }: Props) {
  const reducedMotion = useReducedMotion();
  const mountedAt = useMemo(() => Date.now(), []);

  const discOpacity = useSharedValue(0);
  const discScale = useSharedValue(0.9);
  const ringOpacity = useSharedValue(0);
  const ringScale = useSharedValue(0.85);
  const dashOffset = useSharedValue(RING_CIRCUMFERENCE);
  const coreOpacity = useSharedValue(0);
  const coreScale = useSharedValue(0.5);
  const glowPulse = useSharedValue(1);

  const letter0 = useSharedValue(0);
  const letter1 = useSharedValue(0);
  const letter2 = useSharedValue(0);
  const letter3 = useSharedValue(0);
  const letterProgress = [letter0, letter1, letter2, letter3];

  const containerOpacity = useSharedValue(1);
  const containerScale = useSharedValue(1);

  useEffect(() => {
    if (reducedMotion) {
      discOpacity.value = withTiming(1, { duration: 200 });
      discScale.value = 1;
      ringOpacity.value = withTiming(1, { duration: 200 });
      ringScale.value = 1;
      dashOffset.value = 0;
      coreOpacity.value = withTiming(1, { duration: 200 });
      coreScale.value = 1;
      letterProgress.forEach((v) => {
        v.value = withDelay(150, withTiming(1, { duration: 200 }));
      });
      return;
    }

    discOpacity.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });
    discScale.value = withTiming(1, { duration: 450, easing: Easing.out(Easing.cubic) });

    ringOpacity.value = withDelay(80, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));
    ringScale.value = withDelay(80, withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) }));

    dashOffset.value = withDelay(320, withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) }));

    coreOpacity.value = withDelay(820, withTiming(1, { duration: 260 }));
    coreScale.value = withDelay(
      820,
      withSequence(
        withSpring(1.2, { damping: 6, stiffness: 180 }),
        withSpring(1, { damping: 9, stiffness: 160 })
      )
    );

    glowPulse.value = withDelay(
      1500,
      withRepeat(
        withSequence(
          withTiming(1.12, { duration: 1100, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      )
    );

    letterProgress.forEach((v, i) => {
      v.value = withDelay(1000 + i * 70, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  useEffect(() => {
    if (!ready) return;
    const elapsed = Date.now() - mountedAt;
    const wait = Math.max(MIN_DISPLAY_MS - elapsed, 0);
    const timer = setTimeout(() => {
      containerOpacity.value = withTiming(
        0,
        { duration: EXIT_DURATION_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onExitComplete)();
        }
      );
      containerScale.value = withTiming(1.04, { duration: EXIT_DURATION_MS, easing: Easing.in(Easing.cubic) });
    }, wait);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ scale: containerScale.value }],
  }));

  const discStyle = useAnimatedStyle(() => ({
    opacity: discOpacity.value,
    transform: [{ scale: discScale.value }],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value,
    transform: [{ scale: ringScale.value }],
  }));

  const ringAnimatedProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const coreStyle = useAnimatedStyle(() => ({
    opacity: coreOpacity.value,
    transform: [{ scale: coreScale.value * glowPulse.value }],
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]} pointerEvents="none">
      <View style={styles.logoWrap}>
        <Animated.View style={[styles.disc, discStyle]} />
        <Animated.View style={[styles.ringWrap, ringStyle]}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <Defs>
              <RadialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={ACCENT} stopOpacity={0.5} />
                <Stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={HAIRLINE}
              strokeWidth={RING_STROKE}
              fill="none"
            />
            <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS * 0.62} fill="url(#coreGlow)" />
            <AnimatedCircle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              stroke={ACCENT}
              strokeWidth={RING_STROKE}
              strokeLinecap="round"
              strokeDasharray={RING_CIRCUMFERENCE}
              animatedProps={ringAnimatedProps}
              fill="none"
              rotation={-90}
              origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
            />
          </Svg>
          <Animated.View style={[styles.core, coreStyle]} />
        </Animated.View>
      </View>

      <View style={styles.wordRow}>
        {WORDMARK.map((letter, i) => (
          <LetterReveal key={letter + i} letter={letter} progress={letterProgress[i]} />
        ))}
      </View>
    </Animated.View>
  );
}

function LetterReveal({ letter, progress }: { letter: string; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 10 }],
  }));
  return <Animated.Text style={[styles.letter, style]}>{letter}</Animated.Text>;
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  logoWrap: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disc: {
    position: 'absolute',
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: DISC_SIZE / 2,
    backgroundColor: GLASS,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  ringWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: ACCENT,
    shadowColor: ACCENT,
    shadowOpacity: 0.9,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  wordRow: {
    flexDirection: 'row',
    marginTop: 30,
  },
  letter: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 6,
  },
});
