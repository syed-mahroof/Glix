// client-mobile/app/search.tsx
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { ArrowLeft, SearchIcon, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import api from '../lib/api';
import axios from 'axios';

import PressableScale from '../components/PressableScale';
import { useAppTheme } from '../lib/theme';

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w185';

const DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 2;

interface SearchResult {
  tmdb_id: number;
  title: string;
  overview: string;
  poster_path: string | null;
  first_air_date: string | null;
  vote_average: number;
}

export default function SearchScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (text: string) => {
    setIsSearching(true);
    setError(null);
    try {
      const response = await api.get(`/search/shows/`, {
        params: { query: text, page: 1 },
      });
      setResults(response.data.results ?? []);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.detail ?? 'Search failed. Try again.');
      } else {
        setError('Search failed. Try again.');
      }
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      runSearch(trimmed);
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query, runSearch]);

  const handleResultPress = (tmdbId: number) => {
    router.push(`/show/${tmdbId}`);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.bg }]}>
      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} hitSlop={8} style={styles.backButton}>
          <ArrowLeft color={c.textPrimary} size={22} />
        </PressableScale>
        <View style={[styles.inputRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}>
          <SearchIcon color={c.textTertiary} size={18} />
          <TextInput
            style={[styles.input, { color: c.textPrimary }]}
            placeholder="Search shows"
            placeholderTextColor={c.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoFocus
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <PressableScale onPress={() => setQuery('')} hitSlop={8}>
              <X color={c.textTertiary} size={18} />
            </PressableScale>
          )}
        </View>
      </View>

      {error && (
        <View style={[styles.errorBanner, { backgroundColor: c.negativeDim, borderColor: 'rgba(255, 69, 58, 0.3)' }]}>
          <Text style={[styles.errorText, { color: c.negative }]}>{error}</Text>
        </View>
      )}

      {isSearching ? (
        <View style={styles.centered}>
          <ActivityIndicator color={c.accentInk} size="large" />
        </View>
      ) : query.trim().length < MIN_QUERY_LENGTH ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>Search TMDB for a show to start tracking.</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.emptyText, { color: c.textSecondary }]}>No shows found for "{query.trim()}".</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => String(item.tmdb_id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <PressableScale
              style={[styles.resultRow, { backgroundColor: c.glassFill, borderColor: c.hairline }]}
              onPress={() => handleResultPress(item.tmdb_id)}
            >
              <Image
                source={
                  item.poster_path ? { uri: `${POSTER_BASE_URL}${item.poster_path}` } : undefined
                }
                style={[styles.poster, { backgroundColor: c.bgElevated }]}
                contentFit="cover"
                transition={150}
              />
              <View style={styles.resultTextColumn}>
                <Text style={[styles.resultTitle, { color: c.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.resultMeta, { color: c.accentInk }]} numberOfLines={1}>
                  {item.first_air_date ? item.first_air_date.slice(0, 4) : 'TBA'}
                  {'  ·  '}
                  {'\u2605'} {item.vote_average.toFixed(1)}
                </Text>
                <Text style={[styles.resultOverview, { color: c.textSecondary }]} numberOfLines={2}>
                  {item.overview || 'No description available.'}
                </Text>
              </View>
            </PressableScale>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 14,
    height: 44,
  },
  input: {
    flex: 1,
    fontSize: 15,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 32,
    gap: 12,
  },
  resultRow: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 10,
  },
  poster: {
    width: 56,
    height: 84,
    borderRadius: 8,
  },
  resultTextColumn: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  resultMeta: {
    fontSize: 12,
    fontWeight: '600',
  },
  resultOverview: {
    fontSize: 12,
    lineHeight: 16,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  errorText: {
    fontSize: 13,
  },
});