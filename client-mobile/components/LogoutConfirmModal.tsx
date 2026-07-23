// client-mobile/components/LogoutConfirmModal.tsx
// Replaces the native Alert.alert(...) confirmation previously used for
// logout (Phase J) — that was the one confirmation dialog left rendering
// as bare OS chrome instead of this app's own design system. Visual/UX
// rebuild only; the actual logout logic (performLogout, including its
// clearWidgetData() call) stays entirely in app/settings.tsx, untouched.

import { BlurView } from 'expo-blur';
import { LogOut, X } from 'lucide-react-native';
import React from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const { width } = Dimensions.get('window');

interface LogoutConfirmModalProps {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function LogoutConfirmModal({ visible, onConfirm, onCancel }: LogoutConfirmModalProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  if (!visible) return null;

  return (
    <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(180)} style={StyleSheet.absoluteFill}>
      {/* rgba(0,0,0,0.6) backdrop — the established convention (CascadeModal/
          BadgeUnlockModal), not the inconsistent 0.85 already caught and
          fixed elsewhere in this project. */}
      <View style={styles.backdrop}>
        <Pressable onPress={onCancel} style={StyleSheet.absoluteFill} />
      </View>
      <View style={styles.overlay} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.springify().damping(18).stiffness(200)}
          exiting={SlideOutDown.duration(180)}
          style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
        >
          <BlurView intensity={80} tint={theme.blurTint} style={StyleSheet.absoluteFill} />

          <View style={[styles.iconContainer, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
            <LogOut color={c.negative} size={26} />
          </View>

          <Text style={[styles.title, { color: c.textPrimary }]}>Log Out?</Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            You'll need to sign in again to keep tracking.
          </Text>

          <View style={styles.buttonRow}>
            <PressableScale
              style={[styles.button, { backgroundColor: c.glassFill, borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]}
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <X color={c.textSecondary} size={18} />
              <Text style={[styles.cancelText, { color: c.textSecondary }]}>Cancel</Text>
            </PressableScale>

            {/* Cinema Neon Yellow accent for the confirm action, per this
                app's locked design system — not a red "destructive" button,
                even though logging out is the destructive-ish action here. */}
            <PressableScale
              style={[styles.button, { backgroundColor: c.accentFill }]}
              onPress={onConfirm}
              accessibilityRole="button"
              accessibilityLabel="Confirm log out"
            >
              <LogOut color={c.onAccent} size={18} strokeWidth={2.5} />
              <Text style={[styles.confirmText, { color: c.onAccent }]}>Log Out</Text>
            </PressableScale>
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: Math.min(width - 48, 380),
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 24,
    alignItems: 'center',
    overflow: 'hidden',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
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
});
