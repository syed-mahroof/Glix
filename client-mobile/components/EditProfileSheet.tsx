// client-mobile/components/EditProfileSheet.tsx
// Profile > EDIT sheet (Phase 74). Two actions: rename (username, inline
// validation against the backend's uniqueness/charset check) and change
// photo (hands off to the existing AvatarPickerModal rather than
// duplicating its Cast/Cartoon picker here). Previously "EDIT" opened the
// avatar picker directly, which was a labeling mismatch — the button said
// "EDIT" but only ever edited the photo, never the name.
import { Image } from 'expo-image';
import { Camera, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

interface EditProfileSheetProps {
  visible: boolean;
  username: string;
  avatarUrl: string | null;
  avatarInitials: string;
  onClose: () => void;
  onChangePhoto: () => void;
  /** Returns null on success, or an error message to show inline. */
  onSaveUsername: (next: string) => Promise<string | null>;
}

export default function EditProfileSheet({
  visible,
  username,
  avatarUrl,
  avatarInitials,
  onClose,
  onChangePhoto,
  onSaveUsername,
}: EditProfileSheetProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [draft, setDraft] = useState(username);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Reset the draft to the current username every time the sheet opens —
  // otherwise a prior unsaved edit (or error) would linger into the next
  // open.
  useEffect(() => {
    if (visible) {
      setDraft(username);
      setError(null);
    }
  }, [visible, username]);

  const trimmed = draft.trim();
  const isUnchanged = trimmed === username;

  const handleSave = async () => {
    if (isSaving || isUnchanged || !trimmed) return;
    setIsSaving(true);
    setError(null);
    const result = await onSaveUsername(trimmed);
    setIsSaving(false);
    if (result) {
      setError(result);
    } else {
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: c.bg, borderColor: c.hairline }]} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Edit Profile</Text>
            <PressableScale onPress={onClose} hitSlop={8}>
              <X color={c.textPrimary} size={22} />
            </PressableScale>
          </View>

          <View style={styles.body}>
            <PressableScale style={styles.avatarRow} onPress={onChangePhoto}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={[styles.avatar, { borderColor: c.accentInk }]} />
              ) : (
                <View style={[styles.avatarFallback, { backgroundColor: c.glassFill, borderColor: c.accentInk }]}>
                  <Text style={[styles.avatarInitials, { color: c.accentInk }]}>{avatarInitials}</Text>
                </View>
              )}
              <View style={[styles.avatarBadge, { backgroundColor: c.accentFill, borderColor: c.bg }]}>
                <Camera color={c.onAccent} size={13} strokeWidth={2.5} />
              </View>
              <Text style={[styles.avatarRowLabel, { color: c.accentInk }]}>Change Photo</Text>
            </PressableScale>

            <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>Username</Text>
            <TextInput
              style={[
                styles.input,
                { color: c.textPrimary, backgroundColor: c.glassFill, borderColor: error ? c.negative : c.hairline },
              ]}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (error) setError(null);
              }}
              placeholder="Username"
              placeholderTextColor={c.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={150}
              returnKeyType="done"
              onSubmitEditing={handleSave}
            />
            {error ? <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text> : null}

            <PressableScale
              style={[
                styles.saveBtn,
                { backgroundColor: c.accentFill },
                (isUnchanged || !trimmed) && styles.saveBtnDisabled,
              ]}
              onPress={handleSave}
              disabled={isSaving || isUnchanged || !trimmed}
            >
              {isSaving ? (
                <ActivityIndicator color={c.onAccent} size="small" />
              ) : (
                <Text style={[styles.saveBtnText, { color: c.onAccent }]}>Save</Text>
              )}
            </PressableScale>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const AVATAR_SIZE = 76;

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 8,
  },
  avatarRow: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
  },
  avatarFallback: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontSize: 26,
    fontWeight: '700',
  },
  avatarBadge: {
    position: 'absolute',
    top: AVATAR_SIZE - 20,
    left: '50%',
    marginLeft: 14,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRowLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  errorText: {
    fontSize: 12,
    marginTop: 2,
  },
  saveBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  saveBtnDisabled: {
    opacity: 0.4,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
