import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget } from 'react-native-android-widget';

interface UpcomingWidgetItem {
  id?: number;
  episode_id?: number | null;
  title: string;
  poster_path: string | null;
  next_episode: string;
  air_date: string;
  /** Precomputed via lib/dateFormat.ts's formatCountdown() at sync time —
   *  "3d 05h 12m (Monday)", the exact format the in-app Upcoming tab uses.
   *  Optional: absent on stale cached widget data written before this
   *  field existed, falls back to a plain date. */
  countdown?: string;
}

// Each row deep-links via the app's own `watchtracker://` scheme (app.json)
// straight to the specific upcoming episode (`app/episode/[id].tsx`) when
// one's known, falling back to the show's general page (`app/show/[id].tsx`
// — the same path router.push(`/show/${id}`) uses everywhere else), falling
// back to just opening the app. `episode_id`/`id` are only missing for
// stale cached widget data written before those fields existed.
function widgetUri(show: UpcomingWidgetItem): string | undefined {
  if (show.episode_id != null) return `watchtracker://episode/${show.episode_id}`;
  if (show.id != null) return `watchtracker://show/${show.id}`;
  return undefined;
}

function UpcomingRow({ show }: { show: UpcomingWidgetItem }) {
  const uri = widgetUri(show);
  return (
    <FlexWidget
      clickAction={uri ? 'OPEN_URI' : 'OPEN_APP'}
      clickActionData={uri ? { uri } : undefined}
      style={{
        height: 64,
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 8,
        paddingBottom: 8,
      }}
    >
      {show.poster_path ? (
        <ImageWidget
          image={`https://image.tmdb.org/t/p/w200${show.poster_path}`}
          imageWidth={36}
          imageHeight={52}
          radius={4}
          resizeMode="cover"
          style={{ marginRight: 12 }}
        />
      ) : null}
      <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
        <TextWidget text={show.title} style={{ fontSize: 15, color: '#FFFFFF', fontWeight: 'bold' }} maxLines={1} />
        <TextWidget
          text={`${show.next_episode} • ${show.countdown ?? new Date(show.air_date).toLocaleDateString()}`}
          style={{ fontSize: 12, color: '#B3B3B3', marginTop: 2 }}
          maxLines={1}
        />
      </FlexWidget>
    </FlexWidget>
  );
}

export function UpcomingWidget({ data }: { data: any }) {
  const items: UpcomingWidgetItem[] = data?.upcoming ?? [];

  if (items.length === 0) {
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
        <TextWidget text="Glix" style={{ fontSize: 16, color: '#E4FA1A', fontWeight: 'bold' }} />
        <TextWidget text="No upcoming shows." style={{ fontSize: 14, color: '#FFFFFF', marginTop: 8 }} />
      </FlexWidget>
    );
  }

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
        style={{ fontSize: 12, color: '#E4FA1A', fontWeight: 'bold', marginLeft: 16, marginTop: 12, marginBottom: 4 }}
      />
      {/* Scrollable — everything airing in the next 14 days, capped at 30
          (store/watchStore.ts's syncWidgetData). At the widget's default
          4x2 size only ~1.5 rows are visible; the list itself scrolls to
          reach the rest, and the widget can also be resized taller. */}
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {items.map((show, idx) => (
          <UpcomingRow key={show.id ?? idx} show={show} />
        ))}
      </ListWidget>
    </FlexWidget>
  );
}
