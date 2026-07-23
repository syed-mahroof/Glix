// client-mobile/components/RatingReviewCard.tsx
// Dynamic 1-5 star rating + optional note (Phase L). Self-contained: fetches
// the current user's review for this title on mount, saves via the
// backend's update_or_create semantics (POST always upserts — no separate
// create/update UI distinction), offers delete once a review exists.
// Deliberately local to the detail screen rather than a global store slice
// — nothing else in the app currently needs to react to a review changing
// (no "My Reviews" screen wired into the UI yet; the list endpoints exist
// server-side for one later). Private by default — see ShowReview's model
// docstring for why this isn't wired into the public Comment system.

import { Star, Trash2 } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

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
}

export default function RatingReviewCard({ mediaType, tmdbId }: RatingReviewCardProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const endpoint = mediaType === 'show' ? `/reviews/shows/${tmdbId}/` : `/reviews/movies/${tmdbId}/`;

  const [isLoading, setIsLoading] = useState(true);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
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
        setHasReview(true);
      } catch {
        // 404 = no review left yet — the normal starting state, not an
        // error worth surfacing.
        if (isMounted) {
          setRating(0);
          setNote('');
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
    } catch (err) {
      setRating(previousRating);
      setHasReview(previousHasReview);
      setError(extractErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveNote = async () => {
    if (isSaving || Number.isNaN(tmdbId) || rating === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      await api.post<ReviewResponse>(endpoint, { rating, note });
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
      setHasReview(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

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
          <PressableScale
            key={value}
            onPress={() => handleSelectStar(value)}
            disabled={isSaving}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Rate ${value} star${value !== 1 ? 's' : ''}`}
          >
            <Star
              color={value <= rating ? c.accentInk : c.textTertiary}
              fill={value <= rating ? c.accentInk : 'transparent'}
              size={28}
            />
          </PressableScale>
        ))}
      </View>

      {rating > 0 && (
        <TextInput
          style={[styles.noteInput, { color: c.textPrimary, borderColor: c.hairline }]}
          placeholder="Add a note (optional, only visible to you)"
          placeholderTextColor={c.textTertiary}
          value={note}
          onChangeText={setNote}
          onBlur={handleSaveNote}
          multiline
          maxLength={2000}
        />
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
  noteInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  errorText: {
    fontSize: 12,
  },
});
