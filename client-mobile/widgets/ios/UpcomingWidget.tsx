'widget';
import React from 'react';
import { createWidget } from 'expo-widgets';
import type { WidgetEnvironment } from 'expo-widgets';
import { VStack, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';
import { background, font, foregroundColor, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';

export interface UpcomingWidgetShow {
  title: string;
  next_episode: string;
  air_date: string;
  poster_path: string | null;
  /** Precomputed via lib/dateFormat.ts's formatCountdown() at sync time —
   *  "3d 05h 12m (Monday)", the exact format the in-app Upcoming tab uses.
   *  Optional: absent on stale cached widget data written before this
   *  field existed, falls back to a plain date. */
  countdown?: string;
}

export interface UpcomingWidgetProps {
  upcoming?: UpcomingWidgetShow[];
}

const ACCENT = '#E4FA1A';

const NullState = () => (
  <VStack alignment="center" spacing={8} modifiers={[padding({ all: 16 })]}>
    <Text modifiers={[foregroundColor(ACCENT), font({ size: 16, weight: 'bold' })]}>Glix</Text>
    <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 14 })]}>No upcoming shows.</Text>
  </VStack>
);

function countdownText(show: UpcomingWidgetShow): string {
  return show.countdown ?? new Date(show.air_date).toLocaleDateString();
}

// A compact single-row layout (2 lines, no glyph) for the 2nd item on
// systemMedium — see the matching note in widgets/ios/WatchlistWidget.tsx
// on why this, not a second full hero card or a scrollable list, is the
// real ceiling for a home-screen widget here.
function CompactRow({ show }: { show: UpcomingWidgetShow }) {
  return (
    <VStack alignment="leading" spacing={0}>
      <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>
        {show.title}
      </Text>
      <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.7)'), font({ size: 11 }), lineLimit(1)]}>
        {show.next_episode} • {countdownText(show)}
      </Text>
    </VStack>
  );
}

function Layout(props: UpcomingWidgetProps, environment: WidgetEnvironment) {
  const shows = props?.upcoming ?? [];

  if (shows.length === 0) {
    return (
      <VStack alignment="center" modifiers={[background('#000000')]}>
        <NullState />
      </VStack>
    );
  }

  const hero = shows[0];
  // Home-screen widgets can't scroll (WidgetKit platform constraint) and
  // systemSmall/systemMedium share the same fixed height (app.json's
  // "supportedFamilies" doesn't opt into systemLarge, the one family with
  // real extra vertical room) — so a genuine "next 2 weeks" list can't fit
  // regardless of family. What systemMedium's extra width buys is one
  // compact second row instead of silently dropping the 2nd item.
  const second = environment.widgetFamily === 'systemMedium' ? shows[1] : undefined;

  return (
    <VStack alignment="leading" spacing={8} modifiers={[background('#000000'), padding({ all: 16 })]}>
      <HStack alignment="center">
        <Text modifiers={[foregroundColor(ACCENT), font({ size: 12, weight: 'bold' })]}>AIRING SOON</Text>
        <Spacer />
      </HStack>

      {/* @expo/ui's SwiftUI `Image` bridge (installed ~0.2.0-beta.9) only
          renders SF Symbols via `systemName` — there is no remote-URL image
          loading anywhere in this package (confirmed against its own type
          defs, not assumed), so an actual TMDB poster can't be shown here
          at all. A real capability gap in the dependency version, not a
          regression introduced this pass — a generic glyph stands in. */}
      <Image systemName="calendar.badge.clock" size={28} color={ACCENT} />

      <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 16, weight: 'semibold' }), lineLimit(1)]}>
        {hero.title}
      </Text>
      <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.7)'), font({ size: 14 })]}>
        {hero.next_episode} • {countdownText(hero)}
      </Text>

      {second ? <CompactRow show={second} /> : null}
    </VStack>
  );
}

// Widget name must match the `name` field of the "Upcoming" entry in
// app.json's expo-widgets plugin config. Data is pushed in from
// store/watchStore.ts's syncWidgetData() via .updateSnapshot().
export const UpcomingWidget = createWidget<UpcomingWidgetProps>('Upcoming', Layout);
