'widget';
import React from 'react';
import { createWidget } from 'expo-widgets';
import type { WidgetEnvironment } from 'expo-widgets';
import { VStack, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';
import { background, border, cornerRadius, font, foregroundColor, lineLimit, padding, shapes } from '@expo/ui/swift-ui/modifiers';
import { formatDayBadge } from '../../lib/dateFormat';

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
  loggedOut?: boolean;
}

const ACCENT = '#E4FA1A';

// Same three-way split as widgets/ios/WatchlistWidget.tsx — never synced
// (upcoming === undefined) vs. signed out (loggedOut) vs. genuinely
// nothing airing soon.
const NullState = ({ upcoming, loggedOut }: UpcomingWidgetProps) => {
  const message =
    upcoming === undefined
      ? 'Open Glix to sync your shows.'
      : loggedOut
        ? 'Log in to see upcoming episodes.'
        : 'No upcoming shows.';
  return (
    <VStack alignment="center" spacing={8} modifiers={[padding({ all: 16 })]}>
      <Text modifiers={[foregroundColor(ACCENT), font({ size: 16, weight: 'bold' })]}>Glix</Text>
      <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 14 })]}>{message}</Text>
    </VStack>
  );
};

function countdownText(show: UpcomingWidgetShow): string {
  return show.countdown ?? new Date(show.air_date).toLocaleDateString();
}

// Hero row redesign (Phase 55): a real card — glassmorphism tokens shared
// with the in-app dark theme (lib/theme.ts's `glassFill`/`hairline`, passed
// as raw rgba strings since this SwiftUI bridge can't import the theme
// module's React Native color helpers) instead of bare text floating on the
// widget's black background, plus a bigger, right-aligned day-count badge —
// previously the countdown was buried as small trailing text next to the
// episode line, easy to miss at a glance.
function HeroRow({ show }: { show: UpcomingWidgetShow }) {
  const dayBadge = formatDayBadge(show.air_date, new Date());
  return (
    <HStack
      alignment="center"
      spacing={12}
      modifiers={[
        padding({ all: 12 }),
        background('rgba(30, 30, 30, 0.65)', shapes.roundedRectangle({ cornerRadius: 14 })),
        border({ color: 'rgba(255, 255, 255, 0.12)', width: 1 }),
        cornerRadius(14),
      ]}
    >
      {/* @expo/ui's SwiftUI `Image` bridge (installed ~0.2.0-beta.9) only
          renders SF Symbols via `systemName` — there is no remote-URL image
          loading anywhere in this package (confirmed against its own type
          defs, not assumed), so an actual TMDB poster can't be shown here
          at all. A real capability gap in the dependency version, not a
          regression introduced this pass — a generic glyph stands in. */}
      <Image systemName="calendar.badge.clock" size={26} color={ACCENT} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 16, weight: 'semibold' }), lineLimit(1)]}>
          {show.title}
        </Text>
        <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.7)'), font({ size: 13 }), lineLimit(1)]}>
          {show.next_episode} • {countdownText(show)}
        </Text>
      </VStack>
      <Spacer />
      <Text
        modifiers={[
          foregroundColor(ACCENT),
          font({ size: dayBadge === 'TODAY' ? 14 : 22, weight: 'bold' }),
          lineLimit(1),
        ]}
      >
        {dayBadge}
      </Text>
    </HStack>
  );
}

// A compact single-row card for the 2nd item on systemMedium — same card
// treatment as HeroRow at a smaller scale, not a second full hero (see the
// matching note in widgets/ios/WatchlistWidget.tsx on why one hero + one
// compact row, not a scrollable list, is the real ceiling for a home-screen
// widget here).
function CompactRow({ show }: { show: UpcomingWidgetShow }) {
  const dayBadge = formatDayBadge(show.air_date, new Date());
  return (
    <HStack
      alignment="center"
      modifiers={[
        padding({ all: 10 }),
        background('rgba(30, 30, 30, 0.65)', shapes.roundedRectangle({ cornerRadius: 12 })),
        border({ color: 'rgba(255, 255, 255, 0.12)', width: 1 }),
        cornerRadius(12),
      ]}
    >
      <VStack alignment="leading" spacing={0}>
        <Text modifiers={[foregroundColor('#FFFFFF'), font({ size: 13, weight: 'semibold' }), lineLimit(1)]}>
          {show.title}
        </Text>
        <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.7)'), font({ size: 11 }), lineLimit(1)]}>
          {show.next_episode}
        </Text>
      </VStack>
      <Spacer />
      <Text modifiers={[foregroundColor(ACCENT), font({ size: 13, weight: 'bold' }), lineLimit(1)]}>{dayBadge}</Text>
    </HStack>
  );
}

function Layout(props: UpcomingWidgetProps, environment: WidgetEnvironment) {
  const shows = props?.upcoming ?? [];

  if (shows.length === 0) {
    return (
      <VStack alignment="center" modifiers={[background('#000000')]}>
        <NullState upcoming={props?.upcoming} loggedOut={props?.loggedOut} />
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

      <HeroRow show={hero} />

      {second ? <CompactRow show={second} /> : null}
    </VStack>
  );
}

// Widget name must match the `name` field of the "Upcoming" entry in
// app.json's expo-widgets plugin config. Data is pushed in from
// store/watchStore.ts's syncWidgetData() via .updateSnapshot().
export const UpcomingWidget = createWidget<UpcomingWidgetProps>('Upcoming', Layout);
