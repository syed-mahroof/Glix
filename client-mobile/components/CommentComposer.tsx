// client-mobile/components/CommentComposer.tsx
import { AlertTriangle, Send } from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import PressableScale from './PressableScale';
import { useAppTheme } from '../lib/theme';

const MAX_LENGTH = 2000;

export interface CommentComposerProps {
  onSubmit: (body: string, isSpoiler: boolean) => Promise<void>;
  onCancel?: () => void;
  placeholder?: string;
  initialBody?: string;
  initialIsSpoiler?: boolean;
  submitLabel?: string;
  autoFocus?: boolean;
}

export function CommentComposer({
  onSubmit,
  onCancel,
  placeholder = 'Add a comment...',
  initialBody = '',
  initialIsSpoiler = false,
  submitLabel = 'Post',
  autoFocus = false,
}: CommentComposerProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [body, setBody] = useState(initialBody);
  const [isSpoiler, setIsSpoiler] = useState(initialIsSpoiler);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed, isSpoiler);
      setBody('');
      setIsSpoiler(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post comment.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
      <TextInput
        style={[styles.input, { color: c.textPrimary }]}
        placeholder={placeholder}
        placeholderTextColor={c.textTertiary}
        value={body}
        onChangeText={setBody}
        multiline
        maxLength={MAX_LENGTH}
        autoFocus={autoFocus}
        editable={!isSubmitting}
      />

      {error && <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>}

      <View style={styles.footerRow}>
        <PressableScale
          onPress={() => setIsSpoiler((prev) => !prev)}
          style={[
            styles.spoilerChip,
            { borderColor: c.hairline },
            isSpoiler && { backgroundColor: c.accentFill, borderColor: c.accentFill },
          ]}
          hitSlop={6}
        >
          <AlertTriangle color={isSpoiler ? c.onAccent : c.textSecondary} size={12} />
          <Text style={[styles.spoilerChipText, { color: c.textSecondary }, isSpoiler && { color: c.onAccent }]}>
            Spoiler
          </Text>
        </PressableScale>

        <View style={styles.actionsRow}>
          {onCancel && (
            <PressableScale onPress={onCancel} hitSlop={8} style={styles.cancelButton}>
              <Text style={[styles.cancelButtonText, { color: c.textSecondary }]}>Cancel</Text>
            </PressableScale>
          )}
          <PressableScale
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[styles.submitButton, { backgroundColor: c.accentFill }, !canSubmit && styles.submitButtonDisabled]}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={c.onAccent} />
            ) : (
              <>
                <Send color={c.onAccent} size={13} />
                <Text style={[styles.submitButtonText, { color: c.onAccent }]}>{submitLabel}</Text>
              </>
            )}
          </PressableScale>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
    gap: 8,
  },
  input: {
    fontSize: 13,
    minHeight: 40,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spoilerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  spoilerChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cancelButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  submitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  submitButtonDisabled: {
    opacity: 0.4,
  },
  submitButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    fontSize: 11,
  },
});