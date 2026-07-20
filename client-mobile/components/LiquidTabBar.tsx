import { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { BlurView } from 'expo-blur';
import React, { useEffect } from 'react';
import { Dimensions, Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { elevation, useAppTheme } from '../lib/theme';

const { width } = Dimensions.get('window');
const TAB_BAR_WIDTH = width - 40; // 20px padding on each side
const TAB_WIDTH = TAB_BAR_WIDTH / 4; // Ensure we always have exactly 4 tabs visible

export default function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const visibleRoutes = state.routes.filter(route => {
    const { options } = descriptors[route.key];
    // Cast to any to access expo-router injected properties
    const opt = options as any;
    return opt.href !== null && opt.tabBarItemStyle?.display !== 'none';
  });

  const activeIndex = visibleRoutes.findIndex(route => route.key === state.routes[state.index].key);

  // Fallback to 0 if not found in visibleRoutes
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;
  const translateX = useSharedValue(safeIndex * TAB_WIDTH);

  useEffect(() => {
    translateX.value = withSpring(safeIndex * TAB_WIDTH, {
      damping: 15,
      stiffness: 150,
      mass: 0.5,
    });
  }, [safeIndex, translateX]);

  const animatedIndicatorStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  return (
    <View style={[styles.wrapper, { borderColor: c.hairline }, elevation(theme, 2)]}>
      {/* Layer 1: blur whatever's behind the pill (posters, backdrops). */}
      <BlurView intensity={100} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
      {/* Layer 2: a tint OVER the blur (not just a bg painted under it) —
          this is what actually keeps the bar legible against busy content;
          blur alone still lets bright/high-contrast pixels bleed through. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: c.glassFill }]} />
      {/* Top edge-light — the same "catches light" cue as GlassSurface. */}
      <View style={[styles.edgeLight, { backgroundColor: c.edgeLight }]} />
      <View style={styles.inner}>
        <Animated.View style={[styles.activeIndicatorContainer, animatedIndicatorStyle]}>
          <View style={[styles.activeIndicator, { backgroundColor: c.accentFill }]} />
        </Animated.View>
        {visibleRoutes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.routes[state.index].key === route.key;

            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const color = isFocused ? c.onAccent : c.tabInactive;

            return (
              <Pressable
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={(options as any).tabBarTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                style={styles.tabItem}
              >
                {options.tabBarIcon && options.tabBarIcon({ color, focused: isFocused, size: 24 })}
              </Pressable>
            );
          })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 34 : 20,
    left: 20,
    right: 20,
    height: 64,
    borderRadius: 40,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    // borderColor applied inline from theme token
  },
  edgeLight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    opacity: 0.6,
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    zIndex: 1,
  },
  activeIndicatorContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: TAB_WIDTH,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0,
  },
  activeIndicator: {
    width: 48,
    height: 48,
    borderRadius: 24,
    // backgroundColor applied inline from theme token (accentFill)
  },
});
