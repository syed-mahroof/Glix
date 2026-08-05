import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget } from 'react-native-android-widget';
import {
  formatDayBadge,
  formatLocalAirTime,
  formatUpcomingHeaderLabel,
  formatWeekdayShort,
  resolveDisplayDateIso,
  shouldAppendWeekday,
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

// Flat row on the widget's own black ground (no nested card fill/margins),
// which is what removes the boxed-in look and the dead gap along the right
// edge the per-row card treatment produced. The day count stays as the big
// right-aligned number, with the air time stacked beneath it.
//
// No countdown text here anymore — a home-screen widget redraws on its own
// schedule and can't tick live, so a static countdown was stale the moment
// it rendered (and, before the exact per-episode airstamp existed, wrong by
// up to a day for any slot-less show besides). The day badge plus the
// resolved local air time are the whole release-time line now.
//
// `label` is the resolved DayHeader label this row is grouped under
// (computed once per item by the parent, see `labels` below) — passed down
// purely so shouldAppendWeekday can decide whether this row's subtitle
// needs its own "(Wed)" suffix, for rows sitting under a header that
// doesn't already name a weekday (an absolute date, or 'LATER').
function UpcomingRow({ show, label }: { show: WidgetUpcomingItem; label: string }) {
  const uri = widgetUri(show);
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
          text={`${show.next_episode}${weekdaySuffix}`}
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
  // One pass to resolve each row's label and tally counts, instead of
  // re-scanning the whole (capped-at-50, but still O(n²)) array once per
  // distinct label boundary — labels are computed once per item either way.
  const labels = items.map((show) =>
    formatUpcomingHeaderLabel(
      resolveDisplayDateIso(show.air_date, show.air_datetime, show.airs_time, show.airs_timezone),
      now
    )
  );
  const labelCounts = new Map<string, number>();
  for (const label of labels) labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);

  const children: React.JSX.Element[] = [];
  let lastLabel: string | null = null;
  items.forEach((show, idx) => {
    const label = labels[idx];
    if (label !== lastLabel) {
      if (lastLabel !== null) children.push(<Divider key={`div-${label}`} />);
      children.push(<DayHeader key={`head-${label}`} label={label} count={labelCounts.get(label)!} />);
      lastLabel = label;
    }
    children.push(<UpcomingRow key={`${show.id}-${show.air_date}-${idx}`} show={show} label={label} />);
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
