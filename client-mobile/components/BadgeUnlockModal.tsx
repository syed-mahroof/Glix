import { BlurView } from 'expo-blur';
import { X, Award } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import PressableScale from './PressableScale';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useAppTheme } from '../lib/theme';

const { width } = Dimensions.get('window');

interface BadgeUnlockModalProps {
  visible: boolean;
  badgeName: string;
  badgeDescription: string;
  onClose: () => void;
}

export function BadgeUnlockModal({
  visible,
  badgeName,
  badgeDescription,
  onClose,
}: BadgeUnlockModalProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const glowOpacity = useSharedValue(0.5);

  useEffect(() => {
    if (visible) {
      glowOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.5, { duration: 1000, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        true
      );
    }
  }, [visible, glowOpacity]);

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  if (!visible) return null;

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
      style={StyleSheet.absoluteFill}
    >
      <BlurView intensity={80} tint={theme.blurTint} style={StyleSheet.absoluteFill}>
        <View style={styles.overlay}>
          <Animated.View
            entering={SlideInDown.springify().damping(15)}
            exiting={SlideOutDown.duration(200)}
            style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
          >
            <Animated.View style={[styles.glowBackground, { backgroundColor: c.ambient }, glowStyle]} />
            <PressableScale onPress={onClose} style={styles.closeButton}>
              <X color={c.textPrimary} size={24} />
            </PressableScale>

            <View style={[styles.iconContainer, { backgroundColor: c.accentFill, shadowColor: c.accentFill }]}>
              <Award color={c.onAccent} size={48} />
            </View>

            <Text style={[styles.title, { color: c.textSecondary }]}>Achievement Unlocked!</Text>
            <Text style={[styles.badgeName, { color: c.textPrimary }]}>{badgeName}</Text>
            <Text style={[styles.description, { color: c.textSecondary }]}>{badgeDescription}</Text>

            <PressableScale style={[styles.awesomeButton, { backgroundColor: c.accentFill }]} onPress={onClose}>
              <Text style={[styles.awesomeButtonText, { color: c.onAccent }]}>Awesome</Text>
            </PressableScale>
          </Animated.View>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: Math.min(width - 40, 400),
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 30,
    alignItems: 'center',
    overflow: 'hidden',
  },
  glowBackground: {
    position: 'absolute',
    top: -100,
    left: -100,
    right: -100,
    height: 300,
    borderRadius: 200,
    transform: [{ scaleY: 0.5 }],
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
    padding: 8,
  },
  iconContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 20,
    elevation: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  badgeName: {
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 30,
  },
  awesomeButton: {
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 100,
    width: '100%',
    alignItems: 'center',
  },
  awesomeButtonText: {
    fontSize: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
