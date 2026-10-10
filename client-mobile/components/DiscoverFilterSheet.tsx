import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Check, ChevronRight, Globe, SlidersHorizontal, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MOVIE_GENRES, TV_GENRES } from '../lib/genres';
import { usePrefersReducedMotion } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import { type ActiveSegment, type DiscoverFilters, type Monetization, type SortOrder, useDiscoverStore } from '../store/discoverStore';
import { LANGUAGE_NAMES, languageDisplayName } from './LanguageFilterModal';
import PressableScale from './PressableScale';

const DEFAULT_FILTERS: DiscoverFilters = { selectedGenreId: null, sortOrder: 'trending', selectedLanguage: null, animeOnly: false, selectedProviderIds: [], monetization: 'flatrate|free|ads', recentReleases: false };
const SORTS: { key: SortOrder; label: string }[] = [
  { key: 'trending', label: 'Trending' }, { key: 'popular', label: 'Popular' },
  { key: 'top_rated', label: 'Top Rated' }, { key: 'critically_acclaimed', label: 'Critically Acclaimed' },
];
const ACCESS: { key: Monetization; label: string }[] = [
  { key: 'flatrate|free|ads', label: 'Streaming' }, { key: 'flatrate', label: 'Subscription' },
  { key: 'free|ads', label: 'Free / Ads' }, { key: 'rent|buy', label: 'Rent / Buy' },
  { key: 'flatrate|free|ads|rent|buy', label: 'Any access' },
];

function Pill({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme: { colors: c } } = useAppTheme();
  return (
    <PressableScale accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
      style={[styles.pill, { backgroundColor: selected ? c.accentFill : c.glassFill, borderColor: selected ? c.accentFill : c.hairline }]}>
      <Text style={[styles.pillText, { color: selected ? c.onAccent : c.textPrimary }]}>{label}</Text>
    </PressableScale>
  );
}

interface PickerItem { key: string; label: string; logo?: string | null }
function Picker({ visible, title, items, selected, onSelect, onClose }: {
  visible: boolean; title: string; items: PickerItem[]; selected: string[];
  onSelect: (key: string) => void; onClose: () => void;
}) {
  const { theme: { colors: c } } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => items.filter((item) => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [items, query]);
  useEffect(() => { if (visible) setQuery(''); }, [visible]);
  if (!visible) return null;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[StyleSheet.absoluteFill, styles.scrim]}>
      <Pressable accessibilityLabel="Dismiss picker" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal style={[styles.picker, { backgroundColor: c.bgElevated, paddingBottom: Math.max(16, insets.bottom) }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
            <PressableScale accessibilityLabel="Close picker" accessibilityRole="button" onPress={onClose} style={styles.close}><X color={c.textPrimary} size={22} /></PressableScale>
          </View>
          <TextInput accessibilityLabel={`Search ${title.toLowerCase()}`} placeholder="Search…" placeholderTextColor={c.textSecondary}
            value={query} onChangeText={setQuery} autoCorrect={false} style={[styles.input, { color: c.textPrimary, backgroundColor: c.glassFill, borderColor: c.hairline }]} />
          <FlashList data={filtered} keyExtractor={(item) => item.key} extraData={selected}
            keyboardShouldPersistTaps="handled" renderItem={({ item }) => {
              const checked = selected.includes(item.key);
              return <PressableScale accessibilityRole="checkbox" accessibilityLabel={item.label} accessibilityState={{ checked }} onPress={() => onSelect(item.key)}
                style={[styles.option, { borderBottomColor: c.hairline }]}>
                {item.logo && <Image source={{ uri: `https://image.tmdb.org/t/p/w92${item.logo}` }} recyclingKey={item.key} style={styles.logo} contentFit="contain" />}
                <Text style={[styles.optionText, { color: c.textPrimary }]}>{item.label}</Text>
                {checked && <Check size={20} color={c.accentInk} />}
              </PressableScale>;
            }} ListEmptyComponent={<Text style={[styles.note, { color: c.textSecondary }]}>No matches. Try another name.</Text>} />
          <Pill label="Done" selected onPress={onClose} />
        </View>
    </KeyboardAvoidingView>
  );
}

export default function DiscoverFilterSheet({ activeSegment }: { activeSegment: ActiveSegment }) {
  const visible = useDiscoverStore((s) => s.filterSheetVisible);
  const providers = useDiscoverStore((s) => s.providerOptions);
  const regions = useDiscoverStore((s) => s.availableRegions);
  const region = useDiscoverStore((s) => s.watchRegion);
  const loading = useDiscoverStore((s) => s.isLoadingProviders);
  const error = useDiscoverStore((s) => s.providersError);
  const { closeFilterSheet, applyFilters, fetchProviders, setWatchRegion } = useDiscoverStore.getState();
  const { theme: { colors: c } } = useAppTheme();
  const reducedMotion = usePrefersReducedMotion();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<DiscoverFilters>(DEFAULT_FILTERS);
  const [picker, setPicker] = useState<'platform' | 'region' | 'language' | 'access' | null>(null);
  useEffect(() => {
    if (!visible) { setPicker(null); return; }
    const state = useDiscoverStore.getState();
    setDraft({ selectedGenreId: state.selectedGenreId, sortOrder: state.sortOrder, selectedLanguage: state.selectedLanguage, animeOnly: state.animeOnly, selectedProviderIds: state.selectedProviderIds, monetization: state.monetization, recentReleases: state.recentReleases });
    void fetchProviders(activeSegment);
  }, [visible, activeSegment, fetchProviders]);
  const genres = activeSegment === 'tv' ? TV_GENRES : MOVIE_GENRES;
  const platformItems = useMemo(() => providers.map((provider) => ({ key: String(provider.provider_id), label: provider.provider_name, logo: provider.logo_path })), [providers]);
  const regionItems = useMemo(() => regions.map((item) => ({ key: item.code, label: item.name })), [regions]);
  const selectedNames = providers.filter((provider) => draft.selectedProviderIds.includes(provider.provider_id)).map((provider) => provider.provider_name);
  const update = (value: Partial<DiscoverFilters>) => setDraft((current) => {
    const next = { ...current, ...value };
    if ((next.selectedProviderIds.length || next.monetization !== 'flatrate|free|ads' || next.recentReleases) && next.sortOrder === 'trending') next.sortOrder = 'popular';
    return next;
  });
  const labelStyle = [styles.label, { color: c.textSecondary }];

  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => picker ? setPicker(null) : closeFilterSheet()}>
      <View style={styles.scrim}>
        <Pressable accessibilityLabel="Dismiss filters" onPress={closeFilterSheet} style={StyleSheet.absoluteFill} />
        <View accessibilityViewIsModal accessibilityElementsHidden={picker !== null} importantForAccessibility={picker ? 'no-hide-descendants' : 'auto'} style={[styles.sheet, { maxHeight: height - insets.top - 16, backgroundColor: c.bgElevated, paddingBottom: Math.max(12, insets.bottom) }]}>
          <View style={[styles.handle, { backgroundColor: c.hairline }]} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.textPrimary }]}>Find your next watch</Text>
            <PressableScale accessibilityRole="button" accessibilityLabel="Close filters" onPress={closeFilterSheet} style={styles.close}><X color={c.textPrimary} size={22} /></PressableScale>
          </View>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={labelStyle}>Where to watch</Text>
            <PressableScale onPress={() => setPicker('region')} accessibilityRole="button" accessibilityLabel="Change streaming country" style={[styles.option, { backgroundColor: c.glassFill, borderBottomColor: c.hairline }]}>
              <Globe color={c.textSecondary} size={20} /><Text style={[styles.optionText, { color: c.textPrimary }]}>{regions.find((item) => item.code === region)?.name ?? region}</Text><ChevronRight size={18} color={c.textSecondary} />
            </PressableScale>
            <PressableScale onPress={() => setPicker('platform')} disabled={loading || !!error} accessibilityRole="button" accessibilityLabel="Choose streaming platforms" accessibilityState={{ disabled: loading || !!error }} style={[styles.option, { borderBottomColor: c.hairline }]}>
              <SlidersHorizontal color={c.textSecondary} size={20} /><Text numberOfLines={2} style={[styles.optionText, { color: c.textPrimary }]}>{loading ? 'Loading platforms…' : selectedNames.join(', ') || 'Select platforms'}</Text><ChevronRight size={18} color={c.textSecondary} />
            </PressableScale>
            {error && <PressableScale onPress={() => void fetchProviders(activeSegment)} accessibilityRole="button"><Text style={[styles.note, { color: c.negative }]}>{error} Tap to retry.</Text></PressableScale>}
            <PressableScale onPress={() => setPicker('access')} accessibilityRole="button" accessibilityLabel="Change access type" style={[styles.option, { borderBottomColor: c.hairline }]}>
              <Text style={[styles.optionText, { color: c.textSecondary }]}>Access</Text><Text style={[styles.pillText, { color: c.textPrimary }]}>{ACCESS.find((item) => item.key === draft.monetization)?.label}</Text><ChevronRight size={18} color={c.textSecondary} />
            </PressableScale>
            <Text style={[styles.note, { color: c.textSecondary }]}>Choose up to 8 platforms.</Text>
            <Text style={labelStyle}>Release window</Text>
            <View style={styles.pills}><Pill label="Any time" selected={!draft.recentReleases} onPress={() => update({ recentReleases: false })} /><Pill label="New releases" selected={draft.recentReleases} onPress={() => update({ recentReleases: true })} /></View>
            {draft.recentReleases && <Text style={[styles.note, { color: c.textSecondary }]}>{activeSegment === 'movie' ? 'Digital releases in the last 30 days.' : 'Series with episodes released in the last 30 days.'}</Text>}
            <Text style={labelStyle}>Sort by</Text>
            <View style={styles.pills}>{SORTS.filter((item) => item.key !== 'trending' || (!draft.selectedProviderIds.length && draft.monetization === 'flatrate|free|ads' && !draft.recentReleases)).map((item) => <Pill key={item.key} label={item.label} selected={draft.sortOrder === item.key} onPress={() => update({ sortOrder: item.key })} />)}</View>
            <Text style={labelStyle}>Genre</Text>
            <View style={styles.pills}><Pill label="Any genre" selected={draft.selectedGenreId === null} onPress={() => update({ selectedGenreId: null })} />{genres.map((genre) => <Pill key={genre.id} label={genre.name} selected={draft.selectedGenreId === genre.id} onPress={() => update({ selectedGenreId: draft.selectedGenreId === genre.id ? null : genre.id })} />)}</View>
            <Text style={labelStyle}>Language</Text>
            <View style={styles.pills}><Pill label={draft.selectedLanguage ? languageDisplayName(draft.selectedLanguage) : 'Any language'} selected={draft.selectedLanguage !== null} onPress={() => setPicker('language')} /><Pill label="Anime" selected={draft.animeOnly} onPress={() => update({ animeOnly: !draft.animeOnly, selectedLanguage: null })} /></View>
          </ScrollView>
          <View style={[styles.footer, { borderTopColor: c.hairline }]}>
            <PressableScale accessibilityRole="button" onPress={() => setDraft(DEFAULT_FILTERS)} style={styles.reset}><Text style={{ color: c.textSecondary, fontWeight: '600' }}>Reset</Text></PressableScale>
            <PressableScale accessibilityRole="button" onPress={() => { applyFilters(draft); closeFilterSheet(); }} style={[styles.apply, { backgroundColor: c.accentFill }]}><Text style={{ color: c.onAccent, fontWeight: '700', fontSize: 16 }}>Show matches</Text></PressableScale>
          </View>
        </View>
      </View>
      <Picker visible={picker === 'platform'} title="Streaming platforms" items={platformItems} selected={draft.selectedProviderIds.map(String)} onClose={() => setPicker(null)} onSelect={(key) => {
        const id = Number(key);
        if (!draft.selectedProviderIds.includes(id) && draft.selectedProviderIds.length >= 8) { Alert.alert('Platform limit', 'Choose up to eight platforms. Remove one to add another.'); return; }
        update({ selectedProviderIds: draft.selectedProviderIds.includes(id) ? draft.selectedProviderIds.filter((value) => value !== id) : draft.selectedProviderIds.length < 8 ? [...draft.selectedProviderIds, id] : draft.selectedProviderIds });
      }} />
      <Picker visible={picker === 'region'} title="Streaming country" items={regionItems} selected={[region]} onClose={() => setPicker(null)} onSelect={(key) => { setWatchRegion(key); update({ selectedProviderIds: [] }); setPicker(null); }} />
      <Picker visible={picker === 'access'} title="Access type" items={ACCESS.map((item) => ({ key: item.key, label: item.label }))} selected={[draft.monetization]} onClose={() => setPicker(null)} onSelect={(key) => { update({ monetization: key as Monetization }); setPicker(null); }} />
      <Picker visible={picker === 'language'} title="Languages" items={[{ key: '*', label: 'Any language' }, ...Object.entries(LANGUAGE_NAMES).map(([key, label]) => ({ key, label }))]} selected={[draft.selectedLanguage ?? '*']} onClose={() => setPicker(null)} onSelect={(language) => { update({ selectedLanguage: language === '*' ? null : language, animeOnly: false }); setPicker(null); }} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' },
  picker: { height: '85%', paddingHorizontal: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 8 },
  title: { flex: 1, fontSize: 20, fontWeight: '700' }, close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingBottom: 24 },
  label: { fontSize: 13, fontWeight: '700', marginTop: 24, marginBottom: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  pillText: { fontSize: 14, fontWeight: '600' },
  option: { flexDirection: 'row', gap: 12, alignItems: 'center', minHeight: 56, paddingVertical: 12, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 12 },
  optionText: { flex: 1, fontSize: 15 }, logo: { width: 36, height: 36, borderRadius: 8 },
  note: { fontSize: 13, lineHeight: 19, marginVertical: 12 },
  input: { minHeight: 48, fontSize: 16, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
  footer: { flexDirection: 'row', gap: 16, paddingHorizontal: 20, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  reset: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  apply: { flex: 1, minHeight: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 12 },
});
