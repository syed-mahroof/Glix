'widget';
import React from 'react';
import { createWidget } from 'expo-widgets';
import { VStack, HStack, Text, Image, Spacer } from '@expo/ui/swift-ui';

export interface UpcomingWidgetShow {
  title: string;
  next_episode: string;
  air_date: string;
  poster_path: string | null;
}

export interface UpcomingWidgetProps {
  upcoming?: UpcomingWidgetShow[];
}

const NullState = () => (
  <VStack alignment="center" spacing={8} style={{ padding: 16 }}>
    <Text color="#E4FA1A" font={{ size: 16, weight: 'bold' }}>Glix</Text>
    <Text color="#FFFFFF" font={{ size: 14 }}>No upcoming shows.</Text>
  </VStack>
);

function Layout(props: UpcomingWidgetProps) {
  const show = props?.upcoming?.[0];

  if (!show) {
    return (
      <VStack alignment="center" style={{ backgroundColor: '#000000' }}>
        <NullState />
      </VStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={8} style={{ backgroundColor: '#000000', padding: 16 }}>
      <HStack alignment="center">
        <Text color="#E4FA1A" font={{ size: 12, weight: 'bold' }}>AIRING SOON</Text>
        <Spacer />
      </HStack>

      {show.poster_path ? (
        <Image source={{ uri: `https://image.tmdb.org/t/p/w200${show.poster_path}` }} style={{ width: 40, height: 60, cornerRadius: 4 }} />
      ) : null}

      <Text color="#FFFFFF" font={{ size: 16, weight: 'semibold' }} lineLimit={1}>{show.title}</Text>
      <Text color="rgba(255, 255, 255, 0.7)" font={{ size: 14 }}>{show.next_episode} • {new Date(show.air_date).toLocaleDateString()}</Text>
    </VStack>
  );
}

// Widget name must match the `name` field of the "Upcoming" entry in
// app.json's expo-widgets plugin config. Data is pushed in from
// store/watchStore.ts's syncWidgetData() via .updateSnapshot().
export const UpcomingWidget = createWidget<UpcomingWidgetProps>('Upcoming', Layout);
