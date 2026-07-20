// client-mobile/components/CascadeModal.tsx
// A spring-animated bottom sheet that asks the user whether to mark
// all preceding episodes as watched when checking a later episode.

import { BlurView } from 'expo-blur';
import { Check, X } from 'lucide-react-native';
import React, { useEffect } from 'react';
import {
  Dimensions,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CascadeModalProps {
  visible: boolean;
  showTitle: string;
  episodeLabel: string;
  previousCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  /** "Never for this show" — persists a per-show preference so this
   *  modal stops appearing for future watch-toggles on this show.
   *  Optional so any existing caller that doesn't pass it just doesn't
   *  render the third option. */
  onNeverForThisShow?: () => void;
}

export default function CascadeModal({
  visible,
  showTitle,
  episodeLabel,
  previousCount,
  onConfirm,
  onCancel,
  onNeverForThisShow,
}: CascadeModalProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const translateY = useSharedValue(SCREEN_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      backdropOpacity.value = withTiming(1, { duration: 220 });
      translateY.value = withSpring(0, { damping: 18, stiffness: 180, mass: 0.7 });
    } else {
      backdropOpacity.value = withTiming(0, { duration: 180 });
      translateY.value = withSpring(SCREEN_HEIGHT, { damping: 22, stiffness: 200 });
    }
  }, [visible, translateY, backdropOpacity]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  if (!visible) return null;

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={onCancel}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        </Animated.View>

        <Animated.View style={[styles.sheet, { backgroundColor: c.glassFill, borderColor: c.hairline }, sheetStyle]}>
          <BlurView intensity={80} tint={theme.blurTint} style={StyleSheet.absoluteFill} />

          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.hairline }]} />

          {/* Icon */}
          <View style={[styles.iconContainer, { backgroundColor: c.accentFill }]}>
            <Check color={c.onAccent} size={28} strokeWidth={3} />
          </View>

          {/* Content */}
          <Text style={[styles.title, { color: c.textPrimary }]}>Mark previous episodes?</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            You're marking{' '}
            <Text style={[styles.highlight, { color: c.textPrimary }]}>{episodeLabel}</Text> of{' '}
            <Text style={[styles.highlight, { color: c.textPrimary }]}>{showTitle}</Text> as watched,
            but{' '}
            <Text style={[styles.highlight, { color: c.textPrimary }]}>
              {previousCount} previous episode{previousCount !== 1 ? 's' : ''}
            </Text>{' '}
            {previousCount !== 1 ? 'are' : 'is'} still unwatched.
          </Text>

          {/* Buttons */}
          <View style={styles.buttonRow}>
            <PressableScale
              style={[styles.button, { backgroundColor: c.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel, only mark this episode"
            >
              <X color={c.textSecondary} size={18} />
              <Text style={[styles.cancelText, { color: c.textSecondary }]}>Just this one</Text>
            </PressableScale>

            <PressableScale
              style={[styles.button, { backgroundColor: c.accentFill }]}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Mark all previous episodes watched"
            >
              <Check color={c.onAccent} size={18} strokeWidth={3} />
              <Text style={[styles.confirmText, { color: c.onAccent }]}>Mark all watched</Text>
            </PressableScale>
          </View>

          {onNeverForThisShow && (
            <PressableScale
              style={styles.neverButton}
              onPress={onNeverForThisShow}
              accessibilityRole="button"
              accessibilityLabel="Never ask again for this show"
            >
              <Text style={[styles.neverText, { color: c.textTertiary }]}>Never for this show</Text>
            </PressableScale>
          )}

          {/* Safe area bottom padding */}
          <View style={{ height: Platform.OS === 'ios' ? 34 : 20 }} />
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 24,
    paddingTop: 12,
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 24,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 28,
  },
  highlight: {
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 16,
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmText: {
    fontSize: 15,
    fontWeight: '700',
  },
  neverButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  neverText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
