// client-mobile/components/CommentCard.tsx
import { Image } from 'expo-image';
import { ChevronDown, ChevronUp, X } from 'lucide-react-native';
import React, { memo, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { useAppTheme } from '../lib/theme';
import { CommentActions } from './CommentActions';
import { CommentComposer } from './CommentComposer';
import PressableScale from './PressableScale';
import { CommentItem, ReplyCard } from './ReplyCard';
import { SpoilerOverlay } from './SpoilerOverlay';

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'HARASSMENT', label: 'Harassment or abuse' },
  { value: 'SPOILER', label: 'Unmarked spoiler' },
  { value: 'OFF_TOPIC', label: 'Off-topic' },
  { value: 'OTHER', label: 'Other' },
];

interface PaginatedComments {
  count: number;
  total_pages: number;
  current_page: number;
  next: string | null;
  previous: string | null;
  results: CommentItem[];
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(isoDate).toLocaleDateString();
}

export interface CommentCardProps {
  comment: CommentItem;
  onPress?: () => void;
}

function CommentCardComponent({ comment: initialComment, onPress }: CommentCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [comment, setComment] = useState(initialComment);
  const [isReplying, setIsReplying] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isReportVisible, setIsReportVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replies, setReplies] = useState<CommentItem[]>([]);
  const [areRepliesLoaded, setAreRepliesLoaded] = useState(false);
  const [areRepliesExpanded, setAreRepliesExpanded] = useState(false);
  const [isLoadingReplies, setIsLoadingReplies] = useState(false);

  const handleToggleLike = useCallback(async () => {
    const previous = comment;
    setComment((prev) => ({
      ...prev,
      is_liked_by_user: !prev.is_liked_by_user,
      like_count: prev.like_count + (prev.is_liked_by_user ? -1 : 1),
    }));
    try {
      await api.post(`/comments/${comment.id}/like/`);
    } catch (err) {
      setComment(previous);
      setError(extractErrorMessage(err));
    }
  }, [comment]);

  const loadReplies = useCallback(async () => {
    if (isLoadingReplies) return;
    setIsLoadingReplies(true);
    try {
      const response = await api.get<PaginatedComments>(`/comments/${comment.id}/replies/`);
      setReplies(response.data.results);
      setAreRepliesLoaded(true);
      setAreRepliesExpanded(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsLoadingReplies(false);
    }
  }, [comment.id, isLoadingReplies]);

  const handleToggleReplies = () => {
    if (!areRepliesLoaded) {
      loadReplies();
    } else {
      setAreRepliesExpanded((prev) => !prev);
    }
  };

  const handleSubmitReply = async (body: string, isSpoiler: boolean) => {
    const response = await api.post<CommentItem>(`/comments/${comment.id}/replies/`, {
      body,
      is_spoiler: isSpoiler,
    });
    setReplies((prev) => [...prev, response.data]);
    setAreRepliesLoaded(true);
    setAreRepliesExpanded(true);
    setComment((prev) => ({ ...prev, reply_count: prev.reply_count + 1 }));
    setIsReplying(false);
  };

  const handleSubmitEdit = async (body: string, isSpoiler: boolean) => {
    const response = await api.patch<CommentItem>(`/comments/${comment.id}/`, {
      body,
      is_spoiler: isSpoiler,
    });
    setComment(response.data);
    setIsEditing(false);
  };

  const handleDelete = () => {
    Alert.alert('Delete comment?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/comments/${comment.id}/`);
            setComment((prev) => ({ ...prev, is_deleted: true }));
          } catch (err) {
            setError(extractErrorMessage(err));
          }
        },
      },
    ]);
  };

  const submitReport = async (reason: string) => {
    setIsReportVisible(false);
    try {
      await api.post(`/comments/${comment.id}/report/`, { reason });
      Alert.alert('Reported', 'Thanks — a moderator will review this.');
    } catch (err) {
      setError(extractErrorMessage(err));
    }
  };

  return (
    <PressableScale onPress={onPress} disabled={!onPress} style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={styles.headerRow}>
        {comment.user.profile_picture ? (
          <Image source={{ uri: comment.user.profile_picture }} style={[styles.avatar, { backgroundColor: c.bgElevated }]} />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: c.accentDim }]}>
            <Text style={[styles.avatarFallbackText, { color: c.accentInk }]}>
              {comment.user.username.slice(0, 2).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.headerTextColumn}>
          <Text style={[styles.username, { color: c.textPrimary }]}>{comment.user.username}</Text>
          <Text style={[styles.timestamp, { color: c.textTertiary }]}>
            {timeAgo(comment.created_at)}
            {comment.is_edited ? ' · edited' : ''}
          </Text>
        </View>
      </View>

      {isEditing ? (
        <CommentComposer
          initialBody={comment.body}
          initialIsSpoiler={comment.is_spoiler}
          submitLabel="Save"
          onSubmit={handleSubmitEdit}
          onCancel={() => setIsEditing(false)}
        />
      ) : comment.is_deleted ? (
        <Text style={[styles.deletedText, { color: c.textTertiary }]}>[This comment was deleted]</Text>
      ) : (
        <SpoilerOverlay isSpoiler={comment.is_spoiler}>
          <Text style={[styles.body, { color: c.textPrimary }]}>{comment.body}</Text>
        </SpoilerOverlay>
      )}

      {error && <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>}

      {!comment.is_deleted && !isEditing && (
        <CommentActions
          isLiked={comment.is_liked_by_user}
          likeCount={comment.like_count}
          onToggleLike={handleToggleLike}
          onReplyPress={() => setIsReplying((prev) => !prev)}
          onReportPress={() => setIsReportVisible(true)}
          isOwner={comment.is_owner}
          onEditPress={() => setIsEditing(true)}
          onDeletePress={handleDelete}
        />
      )}

      {isReplying && (
        <View style={styles.composerWrap}>
          <CommentComposer
            placeholder={`Reply to ${comment.user.username}...`}
            submitLabel="Reply"
            onSubmit={handleSubmitReply}
            onCancel={() => setIsReplying(false)}
            autoFocus
          />
        </View>
      )}

      {comment.reply_count > 0 && (
        <PressableScale onPress={handleToggleReplies} style={styles.viewRepliesButton} hitSlop={6}>
          {isLoadingReplies ? (
            <ActivityIndicator size="small" color={c.accentInk} />
          ) : areRepliesExpanded ? (
            <ChevronUp color={c.accentInk} size={14} />
          ) : (
            <ChevronDown color={c.accentInk} size={14} />
          )}
          <Text style={[styles.viewRepliesText, { color: c.accentInk }]}>
            {areRepliesExpanded ? 'Hide replies' : `View ${comment.reply_count} replies`}
          </Text>
        </PressableScale>
      )}

      {areRepliesExpanded &&
        replies.map((reply) => (
          <ReplyCard
            key={reply.id}
            reply={reply}
            depth={1}
            onDeleted={(id) =>
              setReplies((prev) => prev.map((r) => (r.id === id ? { ...r, is_deleted: true } : r)))
            }
          />
        ))}

      <Modal visible={isReportVisible} transparent animationType="fade" onRequestClose={() => setIsReportVisible(false)}>
        <Pressable style={styles.reportBackdrop} onPress={() => setIsReportVisible(false)}>
          <View style={[styles.reportSheet, { backgroundColor: c.bg, borderColor: c.hairline }]}>
            <View style={styles.reportHeader}>
              <Text style={[styles.reportTitle, { color: c.textPrimary }]}>Report comment</Text>
              <PressableScale onPress={() => setIsReportVisible(false)} hitSlop={8}>
                <X color={c.textPrimary} size={18} />
              </PressableScale>
            </View>
            {REPORT_REASONS.map((reason) => (
              <PressableScale
                key={reason.value}
                style={[styles.reportOption, { borderTopColor: c.hairline }]}
                onPress={() => submitReport(reason.value)}
              >
                <Text style={[styles.reportOptionText, { color: c.textPrimary }]}>{reason.label}</Text>
              </PressableScale>
            ))}
          </View>
        </Pressable>
      </Modal>
    </PressableScale>
  );
}

export const CommentCard = memo(CommentCardComponent);

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackText: {
    fontSize: 12,
    fontWeight: '800',
  },
  headerTextColumn: {
    flex: 1,
  },
  username: {
    fontSize: 13,
    fontWeight: '700',
  },
  timestamp: {
    fontSize: 11,
  },
  body: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
  },
  deletedText: {
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 8,
  },
  composerWrap: {
    marginTop: 10,
  },
  viewRepliesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  viewRepliesText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 11,
    marginTop: 6,
  },
  reportBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  reportSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingBottom: 24,
  },
  reportHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  reportTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  reportOption: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reportOptionText: {
    fontSize: 14,
  },
});