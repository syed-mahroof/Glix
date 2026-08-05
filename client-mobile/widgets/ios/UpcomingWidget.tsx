'widget';
import React from 'react';
import { createWidget } from 'expo-widgets';
import type { WidgetEnvironment } from 'expo-widgets';
import { VStack, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';
import { background, font, foregroundColor, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';
import {
  formatDayBadge,
  formatLocalAirTime,
  formatUpcomingHeaderLabel,
  formatWeekdayShort,
  resolveDisplayDateIso,
  shouldAppendWeekday,
} from '../../lib/dateFormat';

export interface UpcomingWidgetShow {
  title: string;
  next_episode: string;
  air_date: string;
  /** Exact UTC instant, from CachedEpisode.air_datetime /
   *  CachedShow.next_episode_air_datetime — preferred over airs_time/
   *  airs_timezone below when present. Absent for episodes TVmaze hasn't
   *  matched yet and on pre-existing cached snapshots. */
  air_datetime?: string | null;
  poster_path: string | null;
  /** The show's broadcast slot — wall clock ("21:30") and its IANA zone,
   *  from TVmaze via the backend. Raw rather than a formatted string on
   *  purpose: the clock time is resolved at render against the live clock,
   *  so a WidgetKit timeline entry generated long after the last app sync
   *  is still correct. Absent for shows with no fixed slot and on
   *  pre-existing cached snapshots. */
  airs_time?: string | null;
  airs_timezone?: string | null;
  /** Carried through from Show.air_time_source (see UpcomingItem.airTimeSource
   *  in lib/upcoming.ts) — which tier resolved airs_time/airs_timezone
   *  above. Combined with air_datetime below to derive isEstimated for the
   *  formatLocalAirTime call, so a platform-estimate time renders with a
   *  "~" instead of identically to a confirmed one. */
  air_time_source?: 'tvmaze_exact' | 'tvmaze_slot' | 'platform_estimate' | '' | null;
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

// Flat rows on the widget's own black ground — no nested card fill, border
// or inset margins, which is what produced the boxed-in look and the dead
// gap along the right edge. The day count stays as the big right-aligned
// number, matching the Android widget exactly.
//
// No countdown text here anymore — a WidgetKit timeline entry is rendered
// well after the app last ran and never re-renders live, so a static
// countdown was stale the instant it appeared. The day badge plus the
// resolved local air time are the whole release-time line now.
//
// `label` is the resolved DayLabel label this row is grouped under
// (computed once per visible row by Layout, see `labels` below) — passed
// down purely so shouldAppendWeekday can decide whether this row's
// subtitle needs its own "(Wed)" suffix, for rows sitting under a header
// that doesn't already name a weekday (an absolute date, or 'LATER').
function UpcomingRowView({ show, compact, label }: { show: UpcomingWidgetShow; compact?: boolean; label: string }) {
  const now = new Date();
  const displayDateIso = resolveDisplayDateIso(show.air_date, show.air_datetime, show.airs_time, show.airs_timezone);
  const dayBadge = formatDayBadge(displayDateIso, now);
  // A platform-estimate slot (backend: CachedShow.air_time_source, see
  // core/airtime.py) rides the same airs_time/airs_timezone pair as a
  // confirmed TVmaze slot, so it resolves and orders identically — only
  // the displayed string needs to own up to being a guess. Excluded the
  // moment a real per-episode airDateTime is known (even for an otherwise
  // platform_estimate-sourced show), since that instant is never a guess.
  const isEstimated =
    show.airs_time != null &&
    show.airs_timezone != null &&
    show.air_time_source === 'platform_estimate' &&
    show.air_datetime == null;
  const airTime = formatLocalAirTime(show.air_date, show.air_datetime, show.airs_time, show.airs_timezone, isEstimated);
  const weekdaySuffix = shouldAppendWeekday(label) ? ` (${formatWeekdayShort(displayDateIso)})` : '';
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
          {`${show.next_episode}${weekdaySuffix}`}
        </Text>
      </VStack>
      <Spacer />
      {/* Day badge over air time, matching the Android widget. The time is
          omitted rather than blanked when the show has no known slot, so
          those rows keep the badge vertically centred. */}
      <VStack alignment="trailing" spacing={0}>
        <Text
          modifiers={[
            foregroundColor(ACCENT),
            font({ size: dayBadge === 'TODAY' ? 13 : compact ? 15 : 20, weight: 'bold' }),
            lineLimit(1),
          ]}
        >
          {dayBadge}
        </Text>
        {airTime ? (
          <Text
            modifiers={[
              foregroundColor('rgba(255, 255, 255, 0.55)'),
              font({ size: compact ? 10 : 11 }),
              lineLimit(1),
            ]}
          >
            {airTime}
          </Text>
        ) : null}
      </VStack>
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
  // label instead of each repeating its own countdown. Labels are computed
  // once per visible row (visible is already capped to maxRows, but there's
  // no reason to re-scan it once per label boundary either).
  const now = new Date();
  const labels = visible.map((show) =>
    formatUpcomingHeaderLabel(
      resolveDisplayDateIso(show.air_date, show.air_datetime, show.airs_time, show.airs_timezone),
      now
    )
  );
  const labelCounts = new Map<string, number>();
  for (const label of labels) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);

  const rows: React.ReactNode[] = [];
  let lastLabel: string | null = null;
  visible.forEach((show, idx) => {
    const label = labels[idx];
    if (label !== lastLabel) {
      rows.push(<DayLabel key={`head-${label}`} label={label} count={labelCounts.get(label)!} />);
      lastLabel = label;
    }
    rows.push(
      <UpcomingRowView key={`${show.title}-${show.air_date}-${idx}`} show={show} compact={compact} label={label} />
    );
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
