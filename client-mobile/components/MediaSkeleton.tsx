import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useAppTheme } from '../lib/theme';

export default function MediaSkeleton({ hero = false }: { hero?: boolean }) {
  const { theme: { colors: c } } = useAppTheme();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading titles" style={styles.container}>
      {hero && <View style={[styles.hero, { backgroundColor: c.glassFill }]} />}
      <View style={styles.grid}>{Array.from({ length: 6 }, (_, index) => (
        <View key={index} style={styles.column}>
          <View style={[styles.poster, { backgroundColor: c.glassFill }]} />
          <View style={[styles.line, { backgroundColor: c.hairline }]} />
        </View>
      ))}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', padding: 20 }, hero: { height: 280, borderRadius: 18, marginBottom: 24 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, column: { width: '30%', gap: 12, marginBottom: 16 },
  poster: { aspectRatio: 2 / 3, borderRadius: 12 }, line: { height: 12, width: '80%', borderRadius: 6 },
});
