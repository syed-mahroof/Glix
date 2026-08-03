// client-mobile/components/RatingReviewCard.tsx
// Half-star (0.5-5, Letterboxd-style) rating + optional note (Phase L;
// Phase 59 added save confirmation, an explicit note-save button, and a
// per-star pop animation; Phase 74 upgraded whole-star to half-star).
// Self-contained: fetches the current user's review for this title on
// mount, saves via the backend's update_or_create semantics (POST always
// upserts — no separate create/update UI distinction), offers delete once
// a review exists. Deliberately local to the detail screen rather than a
// global store slice — the read-only StarRatingDisplay.tsx is what
// app/profile/reviews.tsx's list rows use instead of duplicating this.
// Private by default — see ShowReview's model docstring for why this isn't
// wired into the public Comment system. Save confirmation is reported to
// the caller via onSaved rather than shown here directly — the host
// screens already render their added/removed-from-watchlist Snackbars as
// a ScrollView sibling at the screen root (an absolutely-positioned toast
// nested inside scrolling content would scroll away with it), so this
// reuses that same root-level Snackbar instead of adding a second one.

import { Star, Trash2 } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, type GestureResponderEvent, StyleSheet, Text, TextInput, View } from 'react-native';
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

const STAR_SIZE = 28;

interface RatingReviewCardProps {
  mediaType: 'show' | 'movie';
  tmdbId: number;
  /** Fired after a rating, note, or delete successfully round-trips to the
   *  backend, with a short human-readable message for the caller's own
   *  screen-level Snackbar. */
  onSaved?: (message: string) => void;
  /** Whether the backend would currently accept a review for this title —
   *  at least one episode watched for a show, marked watched for a movie
   *  (Phase 75.3's gate on ShowReviewView/MovieReviewView.post). When
   *  false the stars render dimmed and disabled and the note editor is
   *  replaced with a hint, rather than letting the user compose a review
   *  the backend will 403 on save. */
  canReview: boolean;
}

interface AnimatedStarProps {
  /** This star's integer position, 1-5 — used for the ripple stagger
   *  delay and the half/full hit-zone math, NOT the rating value itself. */
  value: number;
  /** How much of *this* star is filled: 0 (empty), 0.5 (half), or 1 (full). */
  fillLevel: 0 | 0.5 | 1;
  color: string;
  inactiveColor: string;
  disabled: boolean;
  /** Fired with the exact rating this star represents once tapped — 0.5
   *  less than `value` for a left-half tap, `value` for a right-half tap. */
  onSelect: (starValue: number) => void;
}

function AnimatedStar({ value, fillLevel, color, inactiveColor, disabled, onSelect }: AnimatedStarProps) {
  const scale = useSharedValue(1);
  const prevFillLevel = useRef(fillLevel);

  useEffect(() => {
    if (fillLevel > prevFillLevel.current) {
      // Ripple left-to-right (staggered by position) so jumping straight
      // from e.g. 1 to 5 stars reads as one sweeping gesture instead of
      // five stars popping in unison. Keyed on "fill increased" (not
      // "became active") so 3→3.5 pops the 4th star and 3.5→3 doesn't
      // re-pop it.
      scale.value = withDelay(
        (value - 1) * 35,
        withSequence(withTiming(1.35, { duration: 90 }), withSpring(1, { damping: 7, stiffness: 300 }))
      );
    }
    prevFillLevel.current = fillLevel;
  }, [fillLevel, value]);

  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  // Two-zone hit target (left half -> value-0.5, right half -> value) derived
  // from touch position on a single PressableScale — deliberately not two
  // nested Pressables, which would win the touch and kill the outer scale
  // animation above.
  const handlePress = (e: GestureResponderEvent) => {
    const isLeftHalf = e.nativeEvent.locationX < STAR_SIZE / 2;
    onSelect(isLeftHalf ? value - 0.5 : value);
  };

  return (
    <PressableScale
      onPress={handlePress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={`Rate ${value} stars`}
      accessibilityHint="Tap the left half of the star for a half rating"
    >
      <Animated.View style={[animatedStyle, { width: STAR_SIZE, height: STAR_SIZE }]}>
        <Star color={inactiveColor} fill="transparent" size={STAR_SIZE} />
        {fillLevel > 0 && (
          // Left-anchored clip, not StyleSheet.absoluteFill (which also
          // sets `right:0` — combined with an explicit `width` that's an
          // ambiguous double-constraint on Yoga's layout). top/left/height
          // + a plain width is unambiguous: it always clips from the left.
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: STAR_SIZE,
              width: fillLevel >= 1 ? STAR_SIZE : STAR_SIZE / 2,
              overflow: 'hidden',
            }}
          >
            <Star color={color} fill={color} size={STAR_SIZE} />
          </View>
        )}
      </Animated.View>
    </PressableScale>
  );
}

export default function RatingReviewCard({ mediaType, tmdbId, onSaved, canReview }: RatingReviewCardProps) {
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

    // Re-tapping the exact current rating clears it — but only when there's
    // no note to lose. DELETE removes the note too, so auto-firing it on a
    // re-tap when a note exists would be real data loss for a fat-fingered
    // user; the explicit Trash2 button remains the path in that case (a
    // silent no-op here, not an error, since the tap itself is a normal,
    // expected gesture).
    if (hasReview && value === rating) {
      if (savedNote) return;
      await handleDelete();
      return;
    }

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

      <View style={styles.starsRow} accessibilityValue={{ min: 0, max: 5, now: rating }}>
        {[1, 2, 3, 4, 5].map((value) => {
          // rating only ever moves in 0.5 steps (see ALLOWED_RATINGS on the
          // backend), so this clamp always lands on exactly 0, 0.5, or 1.
          const fillLevel = Math.max(0, Math.min(1, rating - (value - 1))) as 0 | 0.5 | 1;
          return (
            <AnimatedStar
              key={value}
              value={value}
              fillLevel={fillLevel}
              color={canReview ? c.accentInk : c.textTertiary}
              inactiveColor={c.textTertiary}
              disabled={isSaving || !canReview}
              onSelect={handleSelectStar}
            />
          );
        })}
      </View>

      {!canReview ? (
        <Text style={[styles.noteCaption, { color: c.textTertiary }]}>
          {mediaType === 'show' ? 'Watch an episode to rate' : 'Mark as watched to rate'}
        </Text>
      ) : (
        rating > 0 && (
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
        )
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
