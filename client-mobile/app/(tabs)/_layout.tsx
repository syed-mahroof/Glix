import { Tabs } from 'expo-router';
import { Tv, Film, Compass, User, type LucideIcon } from 'lucide-react-native';
import React from 'react';
import LiquidTabBar from '../../components/LiquidTabBar';

// Active tabs previously rendered `fill={color}` to look "filled, not just
// recolored." That broke badly in practice: lucide icons are designed as
// stroke-only line art, and forcing a solid fill on arbitrary internal
// paths isn't guaranteed to look right per-icon — Tv/Film degraded into an
// indistinct blob, and Compass/User vanished into the yellow pill entirely
// (their distinguishing detail is carried by open/thin paths that a fill
// swallows). Fixed by dropping `fill` altogether and using lucide's actual
// supported rendering mode instead: a bolder stroke + full-opacity color
// when active. This is guaranteed correct for every icon regardless of its
// internal path structure, not icon-by-icon luck.
//
// Discover uses a Compass rather than a magnifier — the magnifier belongs
// to the real search screen, and reusing it here was a metaphor collision.
function renderTabIcon(Icon: LucideIcon) {
  return ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <Icon color={color} size={focused ? size + 1 : size} strokeWidth={focused ? 2.5 : 2} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Shows',
          tabBarIcon: renderTabIcon(Tv),
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: 'Movies',
          tabBarIcon: renderTabIcon(Film),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: renderTabIcon(Compass),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: renderTabIcon(User),
        }}
      />
      <Tabs.Screen
        name="upcoming"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
