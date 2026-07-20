// client-mobile/components/CommentActions.tsx
import { Flag, MessageCircle, Pencil, Trash2 } from 'lucide-react-native';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '../lib/theme';
import { LikeButton } from './LikeButton';
import PressableScale from './PressableScale';

export interface CommentActionsProps {
  isLiked: boolean;
  likeCount: number;
  onToggleLike: () => Promise<void> | void;
  onReplyPress?: () => void;
  onReportPress: () => void;
  isOwner: boolean;
  onEditPress?: () => void;
  onDeletePress?: () => void;
  compact?: boolean;
}

function CommentActionsComponent({
  isLiked,
  likeCount,
  onToggleLike,
  onReplyPress,
  onReportPress,
  isOwner,
  onEditPress,
  onDeletePress,
  compact = false,
}: CommentActionsProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  return (
    <View style={styles.row}>
      <LikeButton liked={isLiked} count={likeCount} onToggle={onToggleLike} size={compact ? 13 : 15} />

      {onReplyPress && (
        <PressableScale onPress={onReplyPress} hitSlop={8} style={styles.action}>
          <MessageCircle color={c.textSecondary} size={compact ? 13 : 15} />
          <Text style={[styles.actionText, { color: c.textSecondary }]}>Reply</Text>
        </PressableScale>
      )}

      {isOwner ? (
        <>
          {onEditPress && (
            <PressableScale onPress={onEditPress} hitSlop={8} style={styles.action}>
              <Pencil color={c.textSecondary} size={compact ? 13 : 15} />
              <Text style={[styles.actionText, { color: c.textSecondary }]}>Edit</Text>
            </PressableScale>
          )}
          {onDeletePress && (
            <PressableScale onPress={onDeletePress} hitSlop={8} style={styles.action}>
              <Trash2 color={c.negative} size={compact ? 13 : 15} />
              <Text style={[styles.actionTextDanger, { color: c.negative }]}>Delete</Text>
            </PressableScale>
          )}
        </>
      ) : (
        <PressableScale onPress={onReportPress} hitSlop={8} style={styles.action}>
          <Flag color={c.textTertiary} size={compact ? 13 : 15} />
          <Text style={[styles.actionText, { color: c.textSecondary }]}>Report</Text>
        </PressableScale>
      )}
    </View>
  );
}

export const CommentActions = memo(CommentActionsComponent);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 6,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionTextDanger: {
    fontSize: 12,
    fontWeight: '600',
  },
});