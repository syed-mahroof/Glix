// client-mobile/components/LanguageFilterModal.tsx
// Language filter for Profile > My Shows / My Movies. Options come from the
// distinct `original_language` codes already present in the caller's own
// loaded watchlist (client-side derived from the cached TMDB data), never a
// new API request or TMDB's full language list.
import { Check, X } from 'lucide-react-native';
import React from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';

// ISO 639-1 → display name for TMDB's most common `original_language`
// values. Falls back to the raw (uppercased) code for anything not listed
// here, so an unmapped language never breaks the picker.
export const LANGUAGE_NAMES: Record<string, string> = {
  ml: 'Malayalam',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  hi: 'Hindi',
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  zh: 'Chinese',
  ru: 'Russian',
  tr: 'Turkish',
  th: 'Thai',
  sv: 'Swedish',
  da: 'Danish',
  nl: 'Dutch',
  pl: 'Polish',
  ar: 'Arabic',
  id: 'Indonesian',
  cn: 'Cantonese',
};

// Codes that get their own "Major Indian Languages" section; every other
// code present in the caller's data falls under "Global Languages".
const INDIAN_LANGUAGE_CODES = new Set(['ml', 'ta', 'te', 'kn', 'hi']);

export function languageDisplayName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code.toUpperCase();
}

interface LanguageFilterModalProps {
  visible: boolean;
  languages: string[];
  selected: string | null;
  onSelect: (language: string | null) => void;
  onClose: () => void;
}

export default function LanguageFilterModal({
  visible,
  languages,
  selected,
  onSelect,
  onClose,
}: LanguageFilterModalProps) {
  const { theme } = useAppTheme();
  const c = theme.colors;

  const byDisplayName = (a: string, b: string) => languageDisplayName(a).localeCompare(languageDisplayName(b));
  const indianLanguages = languages.filter((code) => INDIAN_LANGUAGE_CODES.has(code)).sort(byDisplayName);
  const globalLanguages = languages.filter((code) => !INDIAN_LANGUAGE_CODES.has(code)).sort(byDisplayName);

  const renderRow = (item: string | null) => {
    const isSelected = selected === item;
    return (
      <PressableScale
        key={item ?? 'ALL'}
        style={[
          styles.row,
          { backgroundColor: c.glassFill, borderColor: c.hairline },
          isSelected && { borderColor: c.accentInk },
        ]}
        onPress={() => {
          onSelect(item);
          onClose();
        }}
      >
        <Text style={[styles.rowText, { color: c.textPrimary }]}>
          {item === null ? 'All languages' : languageDisplayName(item)}
        </Text>
        {isSelected && <Check color={c.accentInk} size={18} strokeWidth={2.5} />}
      </PressableScale>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView style={[styles.sheet, { backgroundColor: c.bg, borderColor: c.hairline }]} edges={['bottom']}>
          <View style={styles.header}>
            <Text style={[styles.headerTitle, { color: c.textPrimary }]}>Language</Text>
            <PressableScale onPress={onClose} hitSlop={8}>
              <X color={c.textPrimary} size={22} />
            </PressableScale>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {renderRow(null)}

            {indianLanguages.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
                  Major Indian Languages
                </Text>
                <View style={styles.sectionGroup}>{indianLanguages.map(renderRow)}</View>
              </>
            )}

            {globalLanguages.length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { color: c.textSecondary }]}>
                  Global Languages
                </Text>
                <View style={styles.sectionGroup}>{globalLanguages.map(renderRow)}</View>
              </>
            )}

            {languages.length === 0 && (
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                No languages to filter by yet.
              </Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  // `sheet` uses maxHeight (not a fixed height) so a short language list
  // still hugs its content instead of leaving empty space — `flexShrink: 1`
  // (not `flex: 1`) is what makes that work: it lets the ScrollView size to
  // content normally, but shrink (and start scrolling internally) once the
  // list is long enough to actually hit the 70% cap. `flex: 1` would fight
  // the parent's content-based sizing and collapse this to zero height for
  // short lists instead. Long lists were previously clipped at the cap with
  // no way to scroll to the tail (Phase 58 — same root cause as
  // DiscoverFilterSheet/WatchlistFilterSheet, different fix because those
  // sheets use a fixed pixel height rather than maxHeight).
  scroll: {
    flexShrink: 1,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 10,
  },
  sectionGroup: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  rowText: {
    fontSize: 15,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 24,
  },
});
