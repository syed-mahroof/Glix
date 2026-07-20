// client-mobile/components/ReactionSummary.tsx
import { Heart, MessageCircle } from 'lucide-react-native';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';

export interface ReactionSummaryProps {
  commentCount: number;
  likeCount?: number;
}

/**
 * Read-only totals strip — distinct from LikeButton (a single comment's
 * interactive like control). Used at the top of a thread/feed screen to
 * summarize the whole list, not any one comment.
 */
function ReactionSummaryComponent({ commentCount, likeCount }: ReactionSummaryProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={[styles.row, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={styles.item}>
        <MessageCircle color={c.accentInk} size={14} />
        <Text style={[styles.text, { color: c.textSecondary }]}>
          {commentCount} comment{commentCount === 1 ? '' : 's'}
        </Text>
      </View>
      {typeof likeCount === 'number' && (
        <View style={styles.item}>
          <Heart color={c.accentInk} size={14} fill={c.accentInk} />
          <Text style={[styles.text, { color: c.textSecondary }]}>
            {likeCount} like{likeCount === 1 ? '' : 's'}
          </Text>
        </View>
      )}
    </View>
  );
}

export const ReactionSummary = memo(ReactionSummaryComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});