// client-mobile/components/WatchlistFilterSheet.tsx
// Bottom sheet for My Shows / My Movies filtering — Language + tag filters
// only (Phase 63 rework). Status (All/Continuing/Ended, etc.) and the Last
// Watched sort both moved back out to a top-of-screen pill row on each
// screen (see shows.tsx/movies.tsx) — they're tab-like, single-select
// controls that belong above the fold, not buried in a sheet the user has
// to open first. This sheet now only holds genuinely supplementary filters:
// Language, and the Anime/Animation tag toggles.
//
// Modeled on `DiscoverFilterSheet`'s Reanimated spring sheet (same backdrop/
// translateY/handle structure) rather than inventing a new sheet mechanism.
// Phase 63 root cause for why this rendered inline behind the list wasn't
// this component at all — it was already a correct absolute-positioned
// overlay. It was mount ORDER in the parent screen: React Native has no
// implicit z-index across siblings, so a sheet mounted before a FlashList
// in JSX paints underneath it regardless of `position: absolute`. Fixed at
// the call site (rendered last, after the list) — see shows.tsx/movies.tsx.

import { BlurView } from 'expo-blur';
import { Languages, type LucideIcon, X } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const SHEET_HEIGHT = SCREEN_HEIGHT * 0.5;

export interface ToggleOption {
  key: string;
  label: string;
  Icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  title: string;
  selectedLanguage: string | null;
  onOpenLanguagePicker: () => void;
  languageDisplay: string;
  tagToggles: ToggleOption[];
  hasActiveFilters: boolean;
  onReset: () => void;
}

function OptionPill({
  label,
  Icon,
  active,
  onPress,
}: {
  label: string;
  Icon?: LucideIcon;
  active: boolean;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <PressableScale
      style={[
        styles.pill,
        { backgroundColor: c.glassFill, borderColor: c.hairline },
        active && { backgroundColor: c.accentFill, borderColor: c.accentFill },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      {Icon && <Icon color={active ? c.onAccent : c.textSecondary} size={14} strokeWidth={2.25} />}
      <Text style={[styles.pillText, { color: c.textSecondary }, active && { color: c.onAccent }]}>
        {label}
      </Text>
    </PressableScale>
  );
}

export default function WatchlistFilterSheet({
  visible,
  onClose,
  title,
  selectedLanguage,
  onOpenLanguagePicker,
  languageDisplay,
  tagToggles,
  hasActiveFilters,
  onReset,
}: Props) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();

  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
      backdropOpacity.value = withSpring(1, { damping: 20 });
    } else {
      translateY.value = withSpring(SHEET_HEIGHT, { damping: 22, stiffness: 250 });
      backdropOpacity.value = withSpring(0, { damping: 22 });
    }
  }, [visible]);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0 ? 'auto' : 'none',
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheet, { borderColor: c.hairline }, sheetStyle]}>
        {/* Two-layer blur+tint (same recipe as LiquidTabBar) instead of a
            flat glassFill background — this sheet floats over poster/photo-
            heavy list content, and the plain 0.65-alpha fill alone read as
            "too see-through" against it. Blur handles whatever's behind it;
            the tint on top is what actually keeps text legible. */}
        <BlurView
          intensity={90}
          tint={theme.blurTint}
          style={[StyleSheet.absoluteFill, styles.sheetClip]}
        />
        <View
          style={[StyleSheet.absoluteFill, styles.sheetClip, { backgroundColor: c.glassFillStrong }]}
        />
        <View style={[styles.handle, { backgroundColor: c.hairline }]} />

        <View style={[styles.sheetHeader, { borderBottomColor: c.hairline }]}>
          <Text style={[styles.sheetTitle, { color: c.textPrimary }]}>{title}</Text>
          <PressableScale
            onPress={onClose}
            style={[styles.closeBtn, { backgroundColor: c.glassFill }]}
            hitSlop={12}
          >
            <X color={c.textSecondary} size={20} strokeWidth={2} />
          </PressableScale>
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator
          persistentScrollbar
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 48 + insets.bottom }]}
        >
          <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>Language</Text>
          <View style={styles.pillRow}>
            <OptionPill
              label={languageDisplay}
              Icon={Languages}
              active={selectedLanguage !== null}
              onPress={onOpenLanguagePicker}
            />
          </View>

          {tagToggles.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: c.textSecondary, marginTop: 24 }]}>Tags</Text>
              <View style={styles.pillRow}>
                {tagToggles.map((opt) => (
                  <OptionPill
                    key={opt.key}
                    label={opt.label}
                    Icon={opt.Icon}
                    active={opt.active}
                    onPress={opt.onPress}
                  />
                ))}
              </View>
            </>
          )}

          {hasActiveFilters && (
            <PressableScale
              style={[styles.resetBtn, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
              onPress={onReset}
            >
              <Text style={[styles.resetText, { color: c.textSecondary }]}>Reset Filters</Text>
            </PressableScale>
          )}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: SHEET_HEIGHT,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  // The blur/tint background layers need their own explicit clip — iOS
  // (unlike Android) doesn't auto-clip a child to its parent's borderRadius.
  sheetClip: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bounds the ScrollView to the sheet's remaining space instead of letting
  // it size to content — same fix, same reason as DiscoverFilterSheet
  // (Phase 58): without it, content past SHEET_HEIGHT was clipped with no
  // way to scroll to it.
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 48,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  pillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
  },
  resetBtn: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  resetText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
