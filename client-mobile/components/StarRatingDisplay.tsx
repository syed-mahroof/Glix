// client-mobile/components/StarRatingDisplay.tsx
// Read-only, half-star-aware star row — the display counterpart to
// RatingReviewCard.tsx's interactive AnimatedStar (Phase 74). Used by
// app/profile/reviews.tsx's list rows, and anywhere else a saved rating
// needs to render without the tap/animation machinery. Half-fill technique:
// one outline star as the base, one filled star clipped to the left half
// via an overflow:'hidden' wrapper — no new dependency, no SVG gradient.
import { Star } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

interface StarRatingDisplayProps {
  /** 0-5 in 0.5 steps. Values outside that range are clamped/rounded to
   *  the nearest half rather than throwing — display-only, never a
   *  source of truth. */
  rating: number;
  size?: number;
  color?: string;
  inactiveColor?: string;
  gap?: number;
}

export default function StarRatingDisplay({
  rating,
  size = 14,
  color,
  inactiveColor,
  gap = 2,
}: StarRatingDisplayProps) {
  // Was `color = '#E4FA1A'` / `inactiveColor = 'rgba(255,255,255,0.3)'` as
  // literal defaults — the white-based inactiveColor in particular was
  // wrong (near-invisible) in light theme. The one current call site
  // (profile/reviews.tsx) already overrides both with real theme tokens,
  // which is why this never visibly manifested, but any future caller
  // that omits either prop would have hit it. Reading from useAppTheme()
  // here instead means there is no hardcoded-hex fallback to hit at all.
  const { theme } = useAppTheme();
  const c = theme.colors;
  const resolvedColor = color ?? c.accentInk;
  const resolvedInactiveColor = inactiveColor ?? c.textTertiary;
  const clamped = Math.max(0, Math.min(5, Math.round(rating * 2) / 2));

  return (
    <View style={[styles.row, { gap }]}>
      {[1, 2, 3, 4, 5].map((value) => {
        const fillLevel = Math.max(0, Math.min(1, clamped - (value - 1)));
        return (
          <View key={value} style={{ width: size, height: size }}>
            <Star size={size} color={resolvedInactiveColor} fill="transparent" />
            {fillLevel > 0 && (
              // Left-anchored clip — see RatingReviewCard.tsx's identical
              // technique for why this is top/left/height+width, not
              // StyleSheet.absoluteFill (whose right:0 double-constrains
              // Yoga against an explicit width).
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: size,
                  width: fillLevel >= 1 ? size : size / 2,
                  overflow: 'hidden',
                }}
              >
                <Star size={size} color={resolvedColor} fill={resolvedColor} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
