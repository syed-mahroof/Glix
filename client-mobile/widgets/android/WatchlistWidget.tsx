import React from 'react';
import { FlexWidget, TextWidget, ImageWidget, ListWidget } from 'react-native-android-widget';
import type { WidgetPayload, WidgetWatchlistItem } from '../../lib/widgetPayload';

type WatchlistWidgetItem = Partial<WidgetWatchlistItem> & Pick<WidgetWatchlistItem, 'title' | 'next_episode' | 'poster_path'>;

// Each row deep-links via the app's own `watchtracker://` scheme (app.json)
// straight to the specific next episode (`app/episode/[id].tsx`) when one's
// known, falling back to the show's general page (`app/show/[id].tsx` — the
// same path router.push(`/show/${id}`) uses everywhere else), falling back
// to just opening the app. `episode_id`/`id` are only missing for stale
// cached widget data written before those fields existed.
function widgetUri(show: WatchlistWidgetItem): string | undefined {
  if (show.episode_id != null) return `watchtracker://episode/${show.episode_id}`;
  if (show.id != null) return `watchtracker://show/${show.id}`;
  return undefined;
}

function WatchlistRow({ show }: { show: WatchlistWidgetItem }) {
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
        <TextWidget text={show.next_episode} style={{ fontSize: 12, color: '#B3B3B3', marginTop: 2 }} maxLines={1} />
      </FlexWidget>
    </FlexWidget>
  );
}

export function WatchlistWidget({ data }: { data: WidgetPayload | null }) {
  const items: WatchlistWidgetItem[] = data?.watchlist ?? [];

  if (items.length === 0) {
    // Three distinct reasons the list can be empty, previously all
    // collapsed into the same "Your watchlist is empty" copy:
    //  - data === null: SharedPreferences has never had a widgetData key
    //    written (fresh install, or storage cleared) — the app hasn't
    //    synced yet, which reads very differently from "you have 0 shows."
    //  - data.loggedOut: store/watchStore.ts's clearWidgetData() wrote this
    //    explicitly on sign-out — showing "empty" here reads as "you have
    //    no shows" when the real state is "you're signed out."
    //  - otherwise: a real sync ran and the watchlist is genuinely empty.
    const message =
      data == null ? 'Open Glix to sync your watchlist.' : data.loggedOut ? 'Log in to see your watchlist.' : 'Your watchlist is empty.';
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
        <TextWidget text={message} style={{ fontSize: 14, color: '#FFFFFF', marginTop: 8 }} />
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
        text="NEXT UP"
        style={{ fontSize: 12, color: '#E4FA1A', fontWeight: 'bold', marginLeft: 16, marginTop: 12, marginBottom: 4 }}
      />
      {/* Full synced list (lib/widgetPayload.ts's WATCHLIST_CAP) scrolls
          natively — see UpcomingWidget.tsx for why this no longer
          re-truncates by measured height on top of that cap. */}
      <ListWidget style={{ height: 'match_parent', width: 'match_parent' }}>
        {items.map((show, idx) => (
          <WatchlistRow key={show.id ?? idx} show={show} />
        ))}
      </ListWidget>
    </FlexWidget>
  );
}
