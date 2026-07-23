'widget';
import React from 'react';
import { createWidget } from 'expo-widgets';
import type { WidgetEnvironment } from 'expo-widgets';
import { VStack, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';
import { background, font, foregroundColor, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';

export interface WatchlistWidgetShow {
  title: string;
  poster_path: string | null;
  next_episode: string;
}

export interface WatchlistWidgetProps {
  watchlist?: WatchlistWidgetShow[];
}

const ACCENT = '#E4FA1A';

const NullState = () => (
  <VStack alignment="center" spacing={8} modifiers={[padding({ all: 16 })]}>
    <Text modifiers={[foregroundColor(ACCENT), font({ size: 16, weight: 'bold' })]}>Glix</Text>
    <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 14 })]}>Your watchlist is empty.</Text>
    <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.6)'), font({ size: 12 })]}>
      Add shows to track them here!
    </Text>
  </VStack>
);

// A compact single-row layout (glyph + 2 lines), as opposed to the full
// hero treatment below — used for the 2nd item on systemMedium, where
// there's no more vertical room to repeat the hero layout (see the
// widgetFamily note in Layout() below).
function CompactRow({ show }: { show: WatchlistWidgetShow }) {
  return (
    <VStack alignment="leading" spacing={0}>
      <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>
        {show.title}
      </Text>
      <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.7)'), font({ size: 11 }), lineLimit(1)]}>
        {show.next_episode}
      </Text>
    </VStack>
  );
}

function Layout(props: WatchlistWidgetProps, environment: WidgetEnvironment) {
  const shows = props?.watchlist ?? [];

  if (shows.length === 0) {
    return (
      <VStack alignment="center" modifiers={[background('#000000')]}>
        <NullState />
      </VStack>
    );
  }

  const hero = shows[0];
  // WidgetKit gives no ScrollView/List in home-screen widgets (a real
  // platform constraint, not a gap here — see widgets/ios/UpcomingWidget.tsx
  // for the same note), and systemSmall/systemMedium share the same fixed
  // height (app.json only opts these two into "supportedFamilies" — no
  // systemLarge, the one family with real extra vertical room). So instead
  // of a second full hero card, systemMedium's extra *width* buys one
  // compact second row rather than a second item being silently dropped —
  // a real, bounded use of the family info the layout ignored entirely
  // before this pass.
  const second = environment.widgetFamily === 'systemMedium' ? shows[1] : undefined;

  return (
    <VStack alignment="leading" spacing={8} modifiers={[background('#000000'), padding({ all: 16 })]}>
      <HStack alignment="center">
        <Text modifiers={[foregroundColor(ACCENT), font({ size: 12, weight: 'bold' })]}>NEXT UP</Text>
        <Spacer />
      </HStack>

      {/* @expo/ui's SwiftUI `Image` bridge (installed ~0.2.0-beta.9) only
          renders SF Symbols via `systemName` — there is no remote-URL image
          loading anywhere in this package (confirmed against its own type
          defs, not assumed), so an actual TMDB poster can't be shown here
          at all. A real capability gap in the dependency version, not a
          regression introduced this pass — a generic glyph stands in. */}
      <Image systemName="tv.fill" size={28} color={ACCENT} />

      <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 16, weight: 'semibold' }), lineLimit(1)]}>
        {hero.title}
      </Text>
      <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.7)'), font({ size: 14 })]}>
        {hero.next_episode}
      </Text>

      {second ? <CompactRow show={second} /> : null}
    </VStack>
  );
}

// Widget name must match the `name` field of the "Watchlist" entry in
// app.json's expo-widgets plugin config. Data is pushed in from
// store/watchStore.ts's syncWidgetData() via .updateSnapshot() — this
// module never reads shared storage itself, expo-widgets handles that.
export const WatchlistWidget = createWidget<WatchlistWidgetProps>('Watchlist', Layout);
