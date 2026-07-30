import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget } from 'react-native-android-widget';
import {
  airDateTimeInstant,
  formatCountdown,
  formatDayBadge,
  formatLocalAirTime,
  formatUpcomingHeaderLabel,
} from '../../lib/dateFormat';
import type { WidgetPayload, WidgetUpcomingItem } from '../../lib/widgetPayload';

const ACCENT = '#E4FA1A';
const SUBTLE = 'rgba(255, 255, 255, 0.55)';
const DIVIDER = 'rgba(255, 255, 255, 0.08)';

// Each row deep-links via the app's own `watchtracker://` scheme (app.json)
// straight to the specific upcoming episode (`app/episode/[id].tsx`) when
// one's known, falling back to the show's general page (`app/show/[id].tsx`
// — the same path router.push(`/show/${id}`) uses everywhere else), falling
// back to just opening the app. `episode_id`/`id` are only missing for
// stale cached widget data written before those fields existed.
function widgetUri(show: Partial<WidgetUpcomingItem>): string | undefined {
  if (show.episode_id != null) return `watchtracker://episode/${show.episode_id}`;
  if (show.id != null) return `watchtracker://show/${show.id}`;
  return undefined;
}

/** Day label above each group, so several shows landing on the same date
 *  read as one day's releases instead of repeating the same countdown on
 *  every row. */
function DayHeader({ label, count }: { label: string; count: number }) {
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 14,
        paddingRight: 14,
        paddingTop: 8,
        paddingBottom: 4,
      }}
    >
      <TextWidget
        text={label}
        style={{ fontSize: 10, color: ACCENT, fontWeight: 'bold' }}
        maxLines={1}
      />
      {count > 1 ? (
        <TextWidget text={`  ·  ${count}`} style={{ fontSize: 10, color: SUBTLE }} maxLines={1} />
      ) : (
        <TextWidget text="" style={{ fontSize: 10, color: SUBTLE }} />
      )}
    </FlexWidget>
  );
}

/**
 * The countdown + clock time for one row, both computed against `now` at
 * render rather than read from the snapshot — the widget redraws on
 * Android's own updatePeriodMillis schedule, routinely while the app isn't
 * running, so anything precomputed at sync time would be stale by exactly
 * however long ago the last sync was.
 *
 * The countdown targets the real air instant when the show has a known
 * broadcast slot, and local midnight otherwise (the old behaviour, and the
 * reason every slot-less countdown still ends in "00m").
 */
function rowTiming(show: WidgetUpcomingItem, now: Date) {
  const instant = airDateTimeInstant(show.air_date, show.airs_time, show.airs_timezone);
  const { formatted, dayOfWeek } = formatCountdown(
    instant ?? new Date(`${show.air_date}T00:00:00`),
    now
  );
  return {
    countdown: `${formatted} (${dayOfWeek})`,
    airTime: formatLocalAirTime(show.air_date, show.airs_time, show.airs_timezone),
  };
}

// Flat row on the widget's own black ground (no nested card fill/margins),
// which is what removes the boxed-in look and the dead gap along the right
// edge the per-row card treatment produced. The day count stays as the big
// right-aligned number, with the air time stacked beneath it.
function UpcomingRow({ show }: { show: WidgetUpcomingItem }) {
  const uri = widgetUri(show);
  const now = new Date();
  const dayBadge = formatDayBadge(show.air_date, now);
  const { countdown, airTime } = rowTiming(show, now);
  return (
    <FlexWidget
      clickAction={uri ? 'OPEN_URI' : 'OPEN_APP'}
      clickActionData={uri ? { uri } : undefined}
      style={{
        height: 58,
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 14,
        paddingRight: 14,
      }}
    >
      {show.poster_path ? (
        <ImageWidget
          image={`https://image.tmdb.org/t/p/w200${show.poster_path}`}
          imageWidth={32}
          imageHeight={46}
          radius={6}
          resizeMode="cover"
          style={{ marginRight: 10 }}
        />
      ) : null}
      <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
        <TextWidget
          text={show.title}
          style={{ fontSize: 14, color: '#FFFFFF', fontWeight: 'bold' }}
          maxLines={1}
        />
        <TextWidget
          text={`${show.next_episode} • ${countdown}`}
          style={{ fontSize: 11, color: SUBTLE, marginTop: 2 }}
          maxLines={1}
        />
      </FlexWidget>
      {/* Day badge over air time, right-aligned — the layout the reference
          widget uses. The time row is dropped entirely (not blanked) for
          shows with no known slot, so those rows keep the badge vertically
          centred instead of sitting above an empty line. */}
      <FlexWidget style={{ flexDirection: 'column', alignItems: 'flex-end' }}>
        <TextWidget
          text={dayBadge}
          style={{
            fontSize: dayBadge === 'TODAY' ? 13 : 19,
            color: ACCENT,
            fontWeight: 'bold',
          }}
          maxLines={1}
        />
        {airTime ? (
          <TextWidget text={airTime} style={{ fontSize: 11, color: SUBTLE }} maxLines={1} />
        ) : null}
      </FlexWidget>
    </FlexWidget>
  );
}

function Divider() {
  return <FlexWidget style={{ height: 1, width: 'match_parent', backgroundColor: DIVIDER }} />;
}

export function UpcomingWidget({ data }: { data: WidgetPayload | null }) {
  const items: WidgetUpcomingItem[] = data?.upcoming ?? [];

  if (items.length === 0) {
    // Same three-way split as widgets/android/WatchlistWidget.tsx — never
    // synced vs. signed out vs. genuinely nothing airing soon.
    const message =
      data == null
        ? 'Open Glix to sync your shows.'
        : data.loggedOut
          ? 'Log in to see upcoming episodes.'
          : 'No upcoming shows.';
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          height: 'match_parent',
          width: 'match_parent',
          backgroundColor: '#000000',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 16,
          borderRadius: 16,
        }}
      >
        <TextWidget text="Glix" style={{ fontSize: 16, color: ACCENT, fontWeight: 'bold' }} />
        <TextWidget text={message} style={{ fontSize: 14, color: '#FFFFFF', marginTop: 8 }} />
      </FlexWidget>
    );
  }

  // The full windowed/capped list (lib/widgetPayload.ts's UPCOMING_CAP)
  // goes into the native ListWidget's children — it's a real scrolling
  // RemoteViews collection (RNWidgetCollectionService), so anything beyond
  // the visible rows is reached by scrolling, not by building more JS
  // elements up front. Slicing again here by measured height used to throw
  // away everything past the first screenful before the list ever got a
  // chance to scroll to it.
  const now = new Date();
  const children: React.JSX.Element[] = [];
  let lastLabel: string | null = null;
  items.forEach((show, idx) => {
    const label = formatUpcomingHeaderLabel(show.air_date, now);
    if (label !== lastLabel) {
      const count = items.filter((s) => formatUpcomingHeaderLabel(s.air_date, now) === label).length;
      if (lastLabel !== null) children.push(<Divider key={`div-${label}`} />);
      children.push(<DayHeader key={`head-${label}`} label={label} count={count} />);
      lastLabel = label;
    }
    children.push(<UpcomingRow key={`${show.id}-${show.air_date}-${idx}`} show={show} />);
  });

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#000000',
        borderRadius: 16,
        flexDirection: 'column',
      }}
    >
      <TextWidget
        text="AIRING SOON"
        style={{
          fontSize: 11,
          color: ACCENT,
          fontWeight: 'bold',
          marginLeft: 14,
          marginTop: 10,
          marginBottom: 2,
        }}
      />
      {/* Scrolls through the whole windowed list; the row budget above only
          bounds how much is built, not what's reachable within it. */}
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>{children}</ListWidget>
    </FlexWidget>
  );
}
