import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import { Check, Search, X } from 'lucide-react-native';
import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Linking, Modal, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';
import { usePrefersReducedMotion } from '../lib/motion';
import { useAppTheme } from '../lib/theme';
import PressableScale from './PressableScale';
import { SegmentedControl } from './SegmentedControl';

type Collection = 'trending' | 'classics';
type Tab = Collection | 'art' | 'icons';
interface CastCharacter { character: string; actor_name?: string; show_title: string; profile_path: string }
interface AvatarOption { uri: string; label: string; subtitle: string }
const cachedCast: Partial<Record<Collection, { items: CastCharacter[]; expires: number }>> = {};
const SEEDS = ['Nova', 'Pixel', 'Comet', 'Juniper', 'Orion', 'Sable', 'Quill', 'Ember'];
function illustrations(styles: readonly string[], version = '9.x'): AvatarOption[] {
  return styles.flatMap((style) => SEEDS.map((seed) => ({
    uri: `https://api.dicebear.com/${version}/${style}/png?seed=${style}-${seed}&size=128`,
    label: seed, subtitle: style.replace(/-/g, ' '),
  })));
}
const ART = [
  ...illustrations(['adventurer', 'big-ears', 'dylan'], '10.x'),
  ...illustrations(['avataaars', 'croodles', 'fun-emoji', 'lorelei', 'open-peeps', 'personas', 'pixel-art', 'bottts-neutral']),
];
const ICONS = illustrations(['identicon', 'rings', 'shapes', 'initials']);

interface AvatarPickerModalProps {
  visible: boolean; currentAvatar: string | null; onClose: () => void; onSelect: (url: string) => void;
}

export default function AvatarPickerModal({ visible, currentAvatar, onClose, onSelect }: AvatarPickerModalProps) {
  const { theme: { colors: c } } = useAppTheme();
  const reducedMotion = usePrefersReducedMotion();
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('classics');
  const [cast, setCast] = useState<CastCharacter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AvatarOption | null>(null);
  useEffect(() => { if (visible) { setSelected(null); setQuery(''); } }, [visible]);
  useEffect(() => { setQuery(''); }, [tab]);
  useEffect(() => {
    if (!visible || (tab !== 'trending' && tab !== 'classics')) return;
    const cached = cachedCast[tab];
    if (cached && cached.expires > Date.now()) { setCast(cached.items); setLoading(false); setError(null); return; }
    const controller = new AbortController();
    setCast([]); setLoading(true); setError(null);
    api.get<{ cast: CastCharacter[] }>('/profile/avatar-options/', { params: { collection: tab }, signal: controller.signal })
      .then(({ data }) => {
        if (controller.signal.aborted) return;
        setCast(data.cast);
        if (data.cast.length) cachedCast[tab] = { items: data.cast, expires: Date.now() + 24 * 60 * 60 * 1000 };
      })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(extractErrorMessage(reason)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [visible, tab, retry]);
  const options = useMemo(() => {
    const items = tab === 'art' ? ART : tab === 'icons' ? ICONS : cast.map((person) => ({
      uri: `https://image.tmdb.org/t/p/w185${person.profile_path}`,
      label: person.character, subtitle: person.show_title,
    }));
    const term = query.trim().toLocaleLowerCase();
    return term ? items.filter((item) => `${item.label} ${item.subtitle}`.toLocaleLowerCase().includes(term)) : items;
  }, [tab, cast, query]);
  const characterTab = tab === 'trending' || tab === 'classics';
  const columns = width < 360 ? 2 : 3;
  const preview = selected?.uri ?? currentAvatar;

  return <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} transparent onRequestClose={onClose}>
    <View style={styles.scrim}>
      <View accessibilityViewIsModal style={[styles.sheet, { height: height * 0.88, maxHeight: height - insets.top - 12, backgroundColor: c.bg, paddingBottom: Math.max(12, insets.bottom) }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.textPrimary }]}>Your screen persona</Text>
          <PressableScale accessibilityRole="button" accessibilityLabel="Close avatar picker" style={styles.close} onPress={onClose}><X size={22} color={c.textPrimary} /></PressableScale>
        </View>
        <View style={[styles.preview, { backgroundColor: c.glassFill }]}>
          {preview ? <Image source={{ uri: preview }} style={styles.previewImage} contentFit="cover" cachePolicy="memory-disk" /> : <View style={[styles.previewImage, { backgroundColor: c.accentDim }]} />}
          <View style={{ flex: 1 }}>
            <Text style={[styles.previewTitle, { color: c.textPrimary }]}>{selected?.label ?? 'Choose your avatar'}</Text>
            <Text style={{ color: c.textSecondary, fontSize: 13 }}>{selected?.subtitle ?? 'A familiar face or a little personality.'}</Text>
          </View>
          {selected && <Check color={c.accentInk} size={20} />}
        </View>
        <View style={styles.tabs}>
          <SegmentedControl<Tab> segments={[{ value: 'classics', label: 'Classics' }, { value: 'trending', label: 'Trending' }, { value: 'art', label: 'Art' }, { value: 'icons', label: 'Icons' }]} selectedValue={tab} onValueChange={setTab} />
        </View>
        <View style={[styles.search, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <Search color={c.textSecondary} size={18} />
          <TextInput accessibilityLabel="Search avatars" placeholder={characterTab ? 'Search character or title…' : 'Search avatar style…'} placeholderTextColor={c.textSecondary} value={query} onChangeText={setQuery} autoCorrect={false} style={[styles.input, { color: c.textPrimary }]} />
        </View>
        {characterTab && loading ? <View accessibilityRole="progressbar" accessibilityLabel="Loading cast portraits" style={styles.skeleton}>
          {Array.from({ length: 6 }, (_, index) => <View key={index} style={[styles.skeletonCircle, { backgroundColor: c.glassFill }]} />)}
        </View> : error && characterTab ? <View style={styles.empty}>
          <Text style={{ color: c.textSecondary, textAlign: 'center' }}>{error}</Text>
          <PressableScale accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={[styles.retry, { backgroundColor: c.accentDim }]}><Text style={{ color: c.accentInk }}>Retry portraits</Text></PressableScale>
        </View> : <FlashList key={`${tab}-${columns}`} data={options} numColumns={columns} keyExtractor={(item) => item.uri} extraData={selected?.uri ?? currentAvatar}
          keyboardShouldPersistTaps="handled" contentContainerStyle={styles.grid} renderItem={({ item }) => {
            const checked = item.uri === (selected?.uri ?? currentAvatar);
            return <PressableScale accessibilityRole="radio" accessibilityLabel={`${item.label}, ${item.subtitle}`} accessibilityState={{ checked }} onPress={() => { Keyboard.dismiss(); setSelected(item); }} style={styles.cell}>
              <View style={[styles.portrait, { borderColor: checked ? c.accentInk : c.hairline, backgroundColor: c.bgElevated }]}>
                <Image source={{ uri: item.uri }} recyclingKey={item.uri} style={styles.image} contentFit="cover" cachePolicy="memory-disk" transition={reducedMotion ? 0 : 150} />
                {checked && <View style={[styles.check, { backgroundColor: c.accentFill }]}><Check size={13} color={c.onAccent} /></View>}
              </View>
              <Text style={[styles.label, { color: c.textPrimary }]} numberOfLines={2}>{item.label}</Text>
              <Text style={[styles.caption, { color: c.textSecondary }]} numberOfLines={2}>{item.subtitle}</Text>
            </PressableScale>;
          }} ListEmptyComponent={<Text style={[styles.emptyText, { color: c.textSecondary }]}>No matches. Try another name or collection.</Text>} />}
        <View style={[styles.footer, { borderTopColor: c.hairline }]}>
          <PressableScale accessibilityRole="button" accessibilityLabel="Avatar sources and licenses" onPress={() => { void Linking.openURL(characterTab ? 'https://www.themoviedb.org/' : 'https://www.dicebear.com/licenses/').catch(() => {}); }}>
            <Text style={[styles.attribution, { color: c.textSecondary }]}>{characterTab ? 'Cast portraits via TMDB · Actor photos' : 'Artwork via DiceBear · Artist licenses'}</Text>
          </PressableScale>
          <PressableScale accessibilityRole="button" disabled={!selected || selected.uri === currentAvatar} onPress={() => { if (selected) onSelect(selected.uri); }}
            style={[styles.save, { backgroundColor: c.accentFill, opacity: !selected || selected.uri === currentAvatar ? 0.45 : 1 }]}><Text style={{ color: c.onAccent, fontWeight: '800', fontSize: 15 }}>Use avatar</Text></PressableScale>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 20, paddingRight: 12, paddingTop: 12 },
  title: { fontSize: 21, fontWeight: '800', flex: 1 }, close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 16, padding: 12, borderRadius: 20 },
  previewImage: { width: 56, height: 56, borderRadius: 28 }, previewTitle: { fontSize: 16, fontWeight: '700' },
  tabs: { paddingHorizontal: 16, paddingVertical: 12 }, search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 14, borderWidth: StyleSheet.hairlineWidth, borderRadius: 16 },
  input: { flex: 1, minHeight: 48, fontSize: 14 }, grid: { paddingHorizontal: 12, paddingBottom: 12 },
  cell: { padding: 8, alignItems: 'center' }, portrait: { width: '100%', maxWidth: 110, aspectRatio: 1, borderRadius: 60, borderWidth: 2, padding: 3 },
  image: { width: '100%', height: '100%', borderRadius: 60 }, check: { position: 'absolute', bottom: 2, right: 2, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { textAlign: 'center', fontWeight: '700', fontSize: 12, marginTop: 7 }, caption: { textAlign: 'center', fontSize: 10, marginTop: 2 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 10, gap: 6 }, attribution: { fontSize: 10, textAlign: 'center', paddingVertical: 8 },
  save: { minHeight: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  skeleton: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-around', padding: 20, gap: 20 }, skeletonCircle: { width: 80, height: 80, borderRadius: 40 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16, padding: 24 }, retry: { minHeight: 48, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 18 },
  emptyText: { textAlign: 'center', padding: 24 },
});
