import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing, ReduceMotion, runOnJS, type SharedValue, useAnimatedStyle, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { elevation, useAppTheme } from '../lib/theme';
import GlassBlur from './GlassBlur';

const SLIDE = { duration: 200, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };

function TabButton({ index, target, position, tabWidth, focused, label, onPress, onLongPress, children }: {
  index: number;
  target: SharedValue<number>;
  position: SharedValue<number>;
  tabWidth: number;
  focused: boolean;
  label: string;
  onPress: () => void;
  onLongPress: () => void;
  children: React.ReactNode;
}) {
  const tap = Gesture.Tap().onEnd((_event, success) => {
    if (!success) return;
    // Start on the UI thread before destination-screen work occupies JS.
    if (target.value !== index) {
      target.value = index;
      position.value = withTiming(index * tabWidth, SLIDE);
    }
    runOnJS(onPress)();
  });
  const longPress = Gesture.LongPress().onStart(() => { runOnJS(onLongPress)(); });
  const accessibility = {
    accessibilityRole: 'button' as const,
    accessibilityLabel: label,
    accessibilityState: { selected: focused },
  };
  if (Platform.OS === 'web') {
    return <Pressable {...accessibility} onPress={onPress} onLongPress={onLongPress} style={styles.tab}>{children}</Pressable>;
  }
  return (
    <GestureDetector gesture={Gesture.Exclusive(longPress, tap)}>
      <Animated.View {...accessibility} accessible onAccessibilityTap={onPress} style={styles.tab}>
        {children}
      </Animated.View>
    </GestureDetector>
  );
}

function LiquidTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(width - 40);
  const routes = state.routes.filter((route) => {
    const options = descriptors[route.key].options as (typeof descriptors)[string]['options'] & { href?: string | null };
    return options.href !== null && StyleSheet.flatten(options.tabBarItemStyle)?.display !== 'none';
  });
  const activeIndex = Math.max(0, routes.findIndex((route) => route.key === state.routes[state.index].key));
  const tabWidth = measuredWidth / Math.max(1, routes.length);
  const target = useSharedValue(activeIndex);
  const position = useSharedValue(activeIndex * tabWidth);
  useEffect(() => {
    // Do not restart an optimistic animation when navigation confirms it.
    if (target.value !== activeIndex) {
      target.value = activeIndex;
      position.value = withTiming(activeIndex * tabWidth, SLIDE);
    }
  }, [activeIndex, target, position, tabWidth]);
  useEffect(() => { position.value = target.value * tabWidth; }, [tabWidth, position, target]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: position.value }] }));

  return (
    <View onLayout={(event) => setMeasuredWidth(event.nativeEvent.layout.width)}
      style={[styles.wrapper, { bottom: Math.max(12, insets.bottom) + 8, borderColor: c.hairline }, elevation(theme, 2)]}>
      <GlassBlur intensity={60} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.glassFill }]} />
      <View pointerEvents="none" style={[styles.edge, { backgroundColor: c.edgeLight }]} />
      <View style={styles.inner}>
        <Animated.View pointerEvents="none" style={[styles.indicatorContainer, { width: tabWidth }, indicator]}>
          <View style={[styles.indicator, { backgroundColor: c.accentFill }]} />
        </Animated.View>
        {routes.map((route, index) => {
          const options = descriptors[route.key].options;
          const focused = state.routes[state.index].key === route.key;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (event.defaultPrevented) {
              target.value = activeIndex;
              position.value = withTiming(activeIndex * tabWidth, SLIDE);
              return;
            }
            if (!focused) navigation.navigate(route.name, route.params);
          };
          return (
            <TabButton key={route.key} index={index} target={target} position={position} tabWidth={tabWidth}
              focused={focused} label={options.tabBarAccessibilityLabel ?? options.title ?? route.name}
              onPress={onPress} onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}>
              {options.tabBarIcon?.({ color: focused ? c.onAccent : c.tabInactive, focused, size: 24 })}
            </TabButton>
          );
        })}
      </View>
    </View>
  );
}

export default React.memo(LiquidTabBar);

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 20, right: 20, height: 64, borderRadius: 40, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth },
  edge: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth, opacity: 0.6 },
  inner: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', height: '100%', zIndex: 1 },
  indicatorContainer: { position: 'absolute', top: 0, left: 0, height: '100%', alignItems: 'center', justifyContent: 'center' },
  indicator: { width: 48, height: 48, borderRadius: 24 },
});
