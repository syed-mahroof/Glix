'widget';
import React from 'react';
import { createWidget } from 'expo-widgets';
import type { WidgetEnvironment } from 'expo-widgets';
import { VStack, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';
import { background, font, foregroundColor, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';
import { formatDayBadge, formatUpcomingHeaderLabel } from '../../lib/dateFormat';

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

// Flat rows on the widget's own black ground — no nested card fill, border
// or inset margins, which is what produced the boxed-in look and the dead
// gap along the right edge. The day count stays as the big right-aligned
// number, matching the Android widget exactly.
function UpcomingRowView({ show, compact }: { show: UpcomingWidgetShow; compact?: boolean }) {
  const dayBadge = formatDayBadge(show.air_date, new Date());
  return (
    <HStack alignment="center" spacing={10} modifiers={[padding({ vertical: compact ? 4 : 6 })]}>
      {/* @expo/ui's SwiftUI `Image` bridge (installed ~0.2.0-beta.9) only
          renders SF Symbols via `systemName` — there is no remote-URL image
          loading anywhere in this package (confirmed against its own type
          defs, not assumed), so an actual TMDB poster can't be shown here
          at all. A real capability gap in the dependency version, not a
          regression introduced this pass — a generic glyph stands in. */}
      <Image systemName="play.tv" size={compact ? 16 : 20} color={ACCENT} />
      <VStack alignment="leading" spacing={1}>
        <Text
          modifiers={[
            foregroundColor('#FFFFFF'),
            font({ size: compact ? 13 : 15, weight: 'semibold' }),
            lineLimit(1),
          ]}
        >
          {show.title}
        </Text>
        <Text
          modifiers={[foregroundColor('rgba(255, 255, 255, 0.55)'), font({ size: compact ? 11 : 12 }), lineLimit(1)]}
        >
          {compact ? show.next_episode : `${show.next_episode} • ${countdownText(show)}`}
        </Text>
      </VStack>
      <Spacer />
      <Text
        modifiers={[
          foregroundColor(ACCENT),
          font({ size: dayBadge === 'TODAY' ? 13 : compact ? 15 : 20, weight: 'bold' }),
          lineLimit(1),
        ]}
      >
        {dayBadge}
      </Text>
    </HStack>
  );
}

/** Day label above each group, so several shows landing on the same date
 *  read as one day's releases instead of repeating a countdown per row. */
function DayLabel({ label, count }: { label: string; count: number }) {
  return (
    <HStack alignment="center" spacing={6}>
      <Text modifiers={[foregroundColor(ACCENT), font({ size: 10, weight: 'bold' }), lineLimit(1)]}>{label}</Text>
      {count > 1 ? (
        <Text modifiers={[foregroundColor('rgba(255, 255, 255, 0.45)'), font({ size: 10 }), lineLimit(1)]}>
          {String(count)}
        </Text>
      ) : null}
      <Spacer />
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

  // Home-screen widgets can't scroll (a WidgetKit platform constraint), so
  // how many rows fit is purely a function of the family's fixed height.
  // systemLarge (now opted into in app.json) is the only one with room for a
  // real multi-day list; small/medium get progressively fewer.
  const family = environment.widgetFamily;
  const maxRows = family === 'systemLarge' ? 7 : family === 'systemMedium' ? 3 : 2;
  const compact = family !== 'systemLarge';
  const visible = shows.slice(0, maxRows);

  // Group by day so two shows releasing on the same date sit under one
  // label instead of each repeating its own countdown.
  const now = new Date();
  const rows: React.ReactNode[] = [];
  let lastLabel: string | null = null;
  visible.forEach((show, idx) => {
    const label = formatUpcomingHeaderLabel(show.air_date, now);
    if (label !== lastLabel) {
      const count = visible.filter((s) => formatUpcomingHeaderLabel(s.air_date, now) === label).length;
      rows.push(<DayLabel key={`head-${label}`} label={label} count={count} />);
      lastLabel = label;
    }
    rows.push(<UpcomingRowView key={`${show.title}-${show.air_date}-${idx}`} show={show} compact={compact} />);
  });

  return (
    <VStack
      alignment="leading"
      spacing={compact ? 2 : 4}
      modifiers={[background('#000000'), padding({ horizontal: 14, vertical: 12 })]}
    >
      <HStack alignment="center">
        <Text modifiers={[foregroundColor(ACCENT), font({ size: 11, weight: 'bold' })]}>AIRING SOON</Text>
        <Spacer />
      </HStack>
      {rows}
    </VStack>
  );
}

// Widget name must match the `name` field of the "Upcoming" entry in
// app.json's expo-widgets plugin config. Data is pushed in from
// store/watchStore.ts's syncWidgetData() via .updateSnapshot().
export const UpcomingWidget = createWidget<UpcomingWidgetProps>('Upcoming', Layout);
