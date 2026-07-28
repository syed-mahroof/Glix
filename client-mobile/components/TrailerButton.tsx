// client-mobile/components/TrailerButton.tsx
// "Watch Trailer" pill for show/movie detail screens — opens the best
// available YouTube trailer/teaser (backend-picked, see
// TMDBService._pick_best_video) via the OS's own YouTube handling (app if
// installed, browser otherwise). No new dependency: expo-linking's
// `Linking.openURL` is already a direct dependency and is exactly what an
// external-app handoff like this needs — an in-app WebView isn't a better
// experience for watching a video than the real YouTube app.
import { Linking } from 'react-native';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Play } from 'lucide-react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

interface Props {
  trailerKey?: string | null;
  style?: StyleProp<ViewStyle>;
}

export default function TrailerButton({ trailerKey, style }: Props) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  if (!trailerKey) return null;

  return (
    <PressableScale
      style={[styles.btn, { backgroundColor: c.glassFill, borderColor: c.hairline }, style]}
      onPress={() => Linking.openURL(`https://www.youtube.com/watch?v=${trailerKey}`)}
      accessibilityRole="button"
      accessibilityLabel="Watch trailer"
    >
      <View style={[styles.iconCircle, { backgroundColor: c.textPrimary }]}>
        <Play color={c.bg} size={10} fill={c.bg} strokeWidth={0} />
      </View>
      <Text style={[styles.label, { color: c.textPrimary }]}>Trailer</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignSelf: 'flex-start',
  },
  iconCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});
