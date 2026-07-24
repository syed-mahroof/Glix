// client-mobile/components/RatingReviewCard.tsx
// Dynamic 1-5 star rating + optional note (Phase L; Phase 59 added save
// confirmation, an explicit note-save button, and a per-star pop
// animation). Self-contained: fetches the current user's review for this
// title on mount, saves via the backend's update_or_create semantics
// (POST always upserts — no separate create/update UI distinction), offers
// delete once a review exists. Deliberately local to the detail screen
// rather than a global store slice — nothing else in the app currently
// needs to react to a review changing (no "My Reviews" screen wired into
// the UI yet; the list endpoints exist server-side for one later).
// Private by default — see ShowReview's model docstring for why this isn't
// wired into the public Comment system. Save confirmation is reported to
// the caller via onSaved rather than shown here directly — the host
// screens already render their added/removed-from-watchlist Snackbars as
// a ScrollView sibling at the screen root (an absolutely-positioned toast
// nested inside scrolling content would scroll away with it), so this
// reuses that same root-level Snackbar instead of adding a second one.

import { Star, Trash2 } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

interface ReviewResponse {
  rating: number;
  note: string;
}

interface RatingReviewCardProps {
  mediaType: 'show' | 'movie';
  tmdbId: number;
  /** Fired after a rating, note, or delete successfully round-trips to the
   *  backend, with a short human-readable message for the caller's own
   *  screen-level Snackbar. */
  onSaved?: (message: string) => void;
}

interface AnimatedStarProps {
  value: number;
  active: boolean;
  color: string;
  inactiveColor: string;
  disabled: boolean;
  onPress: () => void;
}

function AnimatedStar({ value, active, color, inactiveColor, disabled, onPress }: AnimatedStarProps) {
  const scale = useSharedValue(1);
  const wasActive = useRef(active);

  useEffect(() => {
    if (active && !wasActive.current) {
      // Ripple left-to-right (staggered by position) so jumping straight
      // from e.g. 1 to 5 stars reads as one sweeping gesture instead of
      // five stars popping in unison.
      scale.value = withDelay(
        (value - 1) * 35,
        withSequence(withTiming(1.35, { duration: 90 }), withSpring(1, { damping: 7, stiffness: 300 }))
      );
    }
    wasActive.current = active;
  }, [active, value]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Rate ${value} star${value !== 1 ? 's' : ''}`}
    >
      <Animated.View style={animatedStyle}>
        <Star color={active ? color : inactiveColor} fill={active ? color : 'transparent'} size={28} />
      </Animated.View>
    </PressableScale>
  );
}

export default function RatingReviewCard({ mediaType, tmdbId, onSaved }: RatingReviewCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const endpoint = mediaType === 'show' ? `/reviews/shows/${tmdbId}/` : `/reviews/movies/${tmdbId}/`;

  const [isLoading, setIsLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [hasReview, setHasReview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (Number.isNaN(tmdbId)) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    (async () => {
      try {
        const res = await api.get<ReviewResponse>(endpoint);
        if (!isMounted) return;
        setRating(res.data.rating);
        setNote(res.data.note ?? '');
        setSavedNote(res.data.note ?? '');
        setHasReview(true);
      } catch {
        // 404 = no review left yet — the normal starting state, not an
        // error worth surfacing.
        if (isMounted) {
          setRating(0);
          setNote('');
          setSavedNote('');
          setHasReview(false);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [endpoint, tmdbId]);

  const handleSelectStar = async (value: number) => {
    if (isSaving || Number.isNaN(tmdbId)) return;
    const previousRating = rating;
    const previousHasReview = hasReview;
    setRating(value);
    setHasReview(true);
    setIsSaving(true);
    setError(null);
    try {
      await api.post<ReviewResponse>(endpoint, { rating: value, note });
      setSavedNote(note);
      onSaved?.('Rating saved');
    } catch (err) {
      setRating(previousRating);
      setHasReview(previousHasReview);
      setError(extractErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNote = async () => {
    if (isSaving || Number.isNaN(tmdbId) || rating === 0 || note === savedNote) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.post<ReviewResponse>(endpoint, { rating, note });
      setSavedNote(note);
      onSaved?.('Note saved');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isSaving || !hasReview) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.delete(endpoint);
      setRating(0);
      setNote('');
      setSavedNote('');
      setHasReview(false);
      onSaved?.('Review deleted');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const isNoteDirty = note !== savedNote;

  if (isLoading) {
    return (
      <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
        <ActivityIndicator color={c.accentInk} />
      </View>
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: c.textPrimary }]}>Your Rating</Text>
        {hasReview && (
          <PressableScale
            onPress={handleDelete}
            disabled={isSaving}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Delete rating"
          >
            <Trash2 color={c.textTertiary} size={16} />
          </PressableScale>
        )}
      </View>

      <View style={styles.starsRow}>
        {[1, 2, 3, 4, 5].map((value) => (
          <AnimatedStar
            key={value}
            value={value}
            active={value <= rating}
            color={c.accentInk}
            inactiveColor={c.textTertiary}
            disabled={isSaving}
            onPress={() => handleSelectStar(value)}
          />
        ))}
      </View>

      {rating > 0 && (
        <View style={styles.noteBlock}>
          <Text style={[styles.noteCaption, { color: c.textTertiary }]}>Private — only visible to you</Text>
          <TextInput
            style={[styles.noteInput, { color: c.textPrimary, borderColor: c.hairline }]}
            placeholder="Share your thoughts..."
            placeholderTextColor={c.textTertiary}
            value={note}
            onChangeText={setNote}
            onBlur={handleSaveNote}
            multiline
            maxLength={2000}
          />
          <PressableScale
            onPress={handleSaveNote}
            disabled={isSaving || !isNoteDirty}
            hitSlop={8}
            style={styles.saveNoteButton}
            accessibilityRole="button"
            accessibilityLabel="Save note"
          >
            <Text style={[styles.saveNoteText, { color: isNoteDirty ? c.accentInk : c.textTertiary }]}>
              {isSaving ? 'Saving…' : 'Save note'}
            </Text>
          </PressableScale>
        </View>
      )}

      {error && <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  starsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  noteBlock: {
    gap: 6,
  },
  noteCaption: {
    fontSize: 11,
    fontWeight: '600',
  },
  noteInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  saveNoteButton: {
    alignSelf: 'flex-end',
  },
  saveNoteText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 12,
  },
});
