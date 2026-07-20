import React from 'react';
import { FlexWidget, TextWidget, ImageWidget } from 'react-native-android-widget';

export function WatchlistWidget({ data }: { data: any }) {
  if (!data || !data.watchlist || data.watchlist.length === 0) {
    return (
      <FlexWidget
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
        <TextWidget text="Your watchlist is empty." style={{ fontSize: 14, color: '#FFFFFF', marginTop: 8 }} />
      </FlexWidget>
    );
  }

  const show = data.watchlist[0];

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        backgroundColor: '#000000',
        padding: 16,
        borderRadius: 16,
        flexDirection: 'column',
      }}
    >
      <TextWidget text="NEXT UP" style={{ fontSize: 12, color: '#E4FA1A', fontWeight: 'bold', marginBottom: 8 }} />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center' }}>
        {show.poster_path ? (
          <ImageWidget
            image={`https://image.tmdb.org/t/p/w200${show.poster_path}`}
            imageWidth={40}
            imageHeight={60}
            radius={4}
            resizeMode="cover"
            style={{ marginRight: 12 }}
          />
        ) : null}
        <FlexWidget style={{ flexDirection: 'column', flex: 1 }}>
          <TextWidget text={show.title} style={{ fontSize: 16, color: '#FFFFFF', fontWeight: 'bold' }} maxLines={1} />
          <TextWidget text={show.next_episode} style={{ fontSize: 14, color: '#B3B3B3', marginTop: 4 }} />
        </FlexWidget>
      </FlexWidget>
    </FlexWidget>
  );
}
