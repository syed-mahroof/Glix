import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget } from 'react-native-android-widget';
import { formatDayBadge, formatUpcomingHeaderLabel } from '../../lib/dateFormat';
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
// right-aligned number.
function UpcomingRow({ show }: { show: WidgetUpcomingItem }) {
  const uri = widgetUri(show);
  const dayBadge = formatDayBadge(show.air_date, new Date());
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
          text={show.next_episode}
          style={{ fontSize: 11, color: SUBTLE, marginTop: 2 }}
          maxLines={1}
        />
      </FlexWidget>
      <TextWidget
        text={dayBadge}
        style={{
          fontSize: dayBadge === 'TODAY' ? 13 : 19,
          color: ACCENT,
          fontWeight: 'bold',
        }}
        maxLines={1}
      />
    </FlexWidget>
  );
}

function Divider() {
  return <FlexWidget style={{ height: 1, width: 'match_parent', backgroundColor: DIVIDER }} />;
}

export function UpcomingWidget({ data, height }: { data: WidgetPayload | null; height?: number }) {
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

  // Rendering every item as a RemoteViews tree costs real memory (Android
  // hard-caps a widget's transaction size), and anything far past the
  // visible area is unreachable anyway on a widget that only scrolls a
  // little. Budget from the actual measured height the OS hands us on every
  // redraw — a resized-taller widget genuinely gets more rows, which the
  // old fixed cap never did.
  const rowBudget = height ? Math.max(3, Math.ceil((height - 34) / 58) + 3) : 8;
  const visible = items.slice(0, rowBudget);

  const now = new Date();
  const children: React.JSX.Element[] = [];
  let lastLabel: string | null = null;
  visible.forEach((show, idx) => {
    const label = formatUpcomingHeaderLabel(show.air_date, now);
    if (label !== lastLabel) {
      const count = visible.filter((s) => formatUpcomingHeaderLabel(s.air_date, now) === label).length;
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
