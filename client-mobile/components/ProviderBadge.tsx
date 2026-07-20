// client-mobile/components/ProviderBadge.tsx
import { Image } from 'expo-image';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

const LOGO_BASE_URL = 'https://image.tmdb.org/t/p/w92';

export interface ProviderBadgeProps {
  providerName: string;
  logoPath: string | null;
}

function ProviderBadgeComponent({ providerName, logoPath }: ProviderBadgeProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={[styles.badge, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      {logoPath ? (
        <Image
          source={{ uri: `${LOGO_BASE_URL}${logoPath}` }}
          style={[styles.logo, { backgroundColor: c.bgElevated }]}
          contentFit="cover"
          transition={150}
        />
      ) : (
        <View style={[styles.logoFallback, { backgroundColor: c.bgElevated }]} />
      )}
      <Text style={[styles.name, { color: c.textPrimary }]} numberOfLines={1}>
        {providerName}
      </Text>
    </View>
  );
}

export const ProviderBadge = memo(ProviderBadgeComponent);

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  logo: {
    width: 20,
    height: 20,
    borderRadius: 5,
  },
  logoFallback: {
    width: 20,
    height: 20,
    borderRadius: 5,
  },
  name: {
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 120,
  },
});