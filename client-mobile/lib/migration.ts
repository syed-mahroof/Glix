// client-mobile/lib/migration.ts
//
// TV Time Data Import & Glix Export utility.
// Import: reads a TV Time JSON file (Refract extension format), parses and
//         maps it, then sends it to /api/import/tvtime/.
// Export: serializes the Zustand store into a clean JSON and shares it via
//         the native share sheet.

import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

import { api } from './api';
import { useWatchStore } from '../store/watchStore';

// ─── TV Time JSON Shape (Refract export format) ──────────────────────────────

// The real Refract GDPR export nests episode/season indices under
// `number`; some samples in the wild (and this repo's own
// test-tvtime-import.json fixture) use `season_number`/`episode_number`
// instead. Both spellings are accepted — reading only the latter meant
// every season and episode of a real export resolved to `undefined`,
// which the backend then defaulted to 0, matching no episode at all.
interface TVTimeEpisode {
  number?: number;
  episode_number?: number;
  is_watched?: boolean;
  watched_at?: string | null;
}

interface TVTimeSeason {
  number?: number;
  season_number?: number;
  episodes?: TVTimeEpisode[];
}

interface TVTimeShow {
  title: string;
  id?: { tvdb?: string | number | null; imdb?: string | null };
  seasons?: TVTimeSeason[];
  is_watched?: boolean; // sometimes present on shows
}

interface TVTimeMovie {
  title: string;
  id?: { tvdb?: string | number | null; imdb?: string | null };
  is_watched?: boolean;
  watched_at?: string | null;
}

interface ParsedTVTimeFile {
  shows?: TVTimeShow[];
  movies?: TVTimeMovie[];
  // The Refract tool sometimes exports a flat array at top level
  [key: string]: unknown;
}

// ─── Import Result ────────────────────────────────────────────────────────────

export type ImportJobStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

/**
 * Live progress + final result of one import run. The backend resolves
 * every entry against TMDB (~1,100 sequential calls for a full series
 * export), so the POST only enqueues — this is what polling returns.
 */
export interface ImportResult {
  id: string;
  status: ImportJobStatus;
  total: number;
  processed: number;
  progress: number; // 0..1, ready for ProgressRing
  shows_imported: number;
  shows_skipped: number;
  movies_imported: number;
  movies_skipped: number;
  episodes_marked: number;
  errors: string[];
  detail: string;
  created_at: string;
  finished_at: string | null;
}

/** What POST /import/tvtime/ returns now: a handle, not a result. */
interface ImportJobHandle {
  job_id: string;
  total: number;
  status: ImportJobStatus;
}

// ─── Normalise Functions ──────────────────────────────────────────────────────

/**
 * Normalises the raw Refract JSON into a canonical shape accepted by our
 * backend endpoint. The Refract tool produces two separate files:
 *   - tvtime-series-YYYY-MM-DD.json  → array of show objects
 *   - tvtime-movies-YYYY-MM-DD.json  → array of movie objects
 *
 * We support both as well as a combined `{ shows, movies }` object.
 */
function normaliseTVTimePayload(raw: ParsedTVTimeFile): {
  shows: TVTimeShow[];
  movies: TVTimeMovie[];
} {
  // Combined shape: { shows: [...], movies: [...] }
  if (raw.shows || raw.movies) {
    return {
      shows: Array.isArray(raw.shows) ? raw.shows : [],
      movies: Array.isArray(raw.movies) ? raw.movies : [],
    };
  }

  // Flat array — try to detect if it's shows or movies based on the first item
  if (Array.isArray(raw)) {
    const arr = raw as (TVTimeShow | TVTimeMovie)[];
    if (arr.length === 0) return { shows: [], movies: [] };
    const firstItem = arr[0] as TVTimeShow;
    const hasSeasons = firstItem && 'seasons' in firstItem;
    if (hasSeasons) {
      return { shows: arr as TVTimeShow[], movies: [] };
    }
    return { shows: [], movies: arr as TVTimeMovie[] };
  }

  return { shows: [], movies: [] };
}

// ─── Main Import Function ─────────────────────────────────────────────────────

/**
 * Opens the native document picker, reads the selected JSON file, and
 * hands the normalised payload to the backend, which enqueues it.
 *
 * Returns a job handle to poll with pollImportJob(), or null if the user
 * cancels the picker. Throws on network/parsing errors (catch in UI).
 */
export async function importTVTimeData(): Promise<ImportJobHandle | null> {
  // 1. Pick file
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]?.uri) {
    return null; // user cancelled
  }

  const fileUri = result.assets[0].uri;
  console.log('--- STARTING IMPORT ---');
  console.log('Picked file URI:', fileUri);

  // 2. Read file content
  let rawText: string;
  try {
    rawText = await FileSystem.readAsStringAsync(fileUri, {
      encoding: 'utf8',
    });
    console.log('File read successfully, length:', rawText.length);
  } catch (e: any) {
    console.error('ERROR reading file:', e);
    throw new Error(`Could not read file (${fileUri}): ${e.message}`);
  }

  // 3. Parse JSON
  let parsed: ParsedTVTimeFile;
  try {
    parsed = JSON.parse(rawText);
    console.log('JSON parsed successfully');
  } catch (e: any) {
    console.error('ERROR parsing JSON:', e);
    throw new Error(
      'The file does not contain valid JSON. Please select a TV Time export file.'
    );
  }

  // 4. Normalise to backend shape
  const payload = normaliseTVTimePayload(parsed);

  if (payload.shows.length === 0 && payload.movies.length === 0) {
    throw new Error(
      'No shows or movies found in this file. Make sure you selected a TV Time series or movies export.'
    );
  }

  // 5. Map to backend expected format.
  //
  // Both external ids are forwarded because the two exports carry
  // different ones: series entries have only `id.tvdb` (imdb is null on
  // every row), while movies have a real `id.imdb`. The backend picks
  // the right handle per media type — notably it ignores `tvdb` for
  // movies, where TV Time writes its own internal number rather than a
  // real TVDB id. `watched_at` is forwarded so the backend can preserve
  // the original watch date instead of stamping everything "now".
  const backendPayload = {
    shows: payload.shows.map((s) => ({
      title: s.title,
      tvdb_id: s.id?.tvdb ?? null,
      imdb_id: s.id?.imdb ?? null,
      seasons: (s.seasons ?? []).map((season) => ({
        season_number: season.number ?? season.season_number ?? null,
        episodes: (season.episodes ?? []).map((ep) => ({
          episode_number: ep.number ?? ep.episode_number ?? null,
          is_watched: ep.is_watched ?? false,
          watched_at: ep.watched_at ?? null,
        })),
      })),
    })),
    movies: payload.movies.map((m) => ({
      title: m.title,
      tvdb_id: m.id?.tvdb ?? null,
      imdb_id: m.id?.imdb ?? null,
      is_watched: m.is_watched ?? false,
      watched_at: m.watched_at ?? null,
    })),
  };

  // 6. Enqueue. Returns a job handle immediately — the work runs on a
  //    Celery worker and is polled via pollImportJob().
  const response = await api.post<ImportJobHandle>('/import/tvtime/', backendPayload);
  return response.data;
}

/** One status read for an in-flight import. */
export async function fetchImportJob(jobId: string): Promise<ImportResult> {
  const response = await api.get<ImportResult>(`/import/status/${jobId}/`);
  return response.data;
}

/**
 * Polls an import job to completion, reporting progress as it goes.
 * Resolves with the terminal job state (SUCCESS or FAILED) — a FAILED
 * job is a resolved result carrying `detail`, not a thrown error, so the
 * UI can render the same summary either way.
 */
export async function pollImportJob(
  jobId: string,
  onProgress?: (job: ImportResult) => void,
  intervalMs = 1500
): Promise<ImportResult> {
  // A 200-series export is minutes of TMDB round-trips; this ceiling
  // (~20 min) exists only so a wedged worker can't poll forever.
  const maxAttempts = Math.ceil((20 * 60 * 1000) / intervalMs);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const job = await fetchImportJob(jobId);
    onProgress?.(job);
    if (job.status === 'SUCCESS' || job.status === 'FAILED') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Import is taking longer than expected. Check back shortly.');
}

// ─── Export Function ──────────────────────────────────────────────────────────

/**
 * Serialises the current Zustand store state into a structured JSON and
 * triggers the native share sheet so the user can save or send the file.
 */
export async function exportGlixData(): Promise<void> {
  const state = useWatchStore.getState();

  const exportPayload = {
    exported_at: new Date().toISOString(),
    app: 'Glix',
    version: '2.0',
    profile: state.profile
      ? {
          username: state.profile.username,
          total_time_watched_minutes: state.profile.total_time_watched,
          watched_days: state.profile.watched_days,
          earned_badges: state.profile.earned_badges,
        }
      : null,
    shows: [
      ...state.watchlist.to_watch.results,
      ...state.watchlist.up_to_date.results,
      ...state.watchlist.archived.results,
    ].map((entry) => ({
      tmdb_id: entry.show.tmdb_id,
      title: entry.show.title,
      status: entry.status,
      is_favorite: entry.is_favorite,
      progress_percentage: entry.progress_percentage,
      watched_episode_count: entry.watched_episode_count,
      episodes: entry.show.episodes.map((ep) => ({
        tmdb_id: ep.tmdb_id,
        season: ep.season_number,
        episode: ep.episode_number,
        title: ep.title,
        is_watched: ep.is_watched,
      })),
    })),
    movies: [
      ...state.movieWatchlist.watch_next,
      ...state.movieWatchlist.watched,
    ].map((item) => ({
      tmdb_id: item.movie.tmdb_id,
      title: item.movie.title,
      is_watched: item.movie.is_watched,
      runtime_minutes: item.movie.runtime_minutes,
    })),
  };

  const jsonString = JSON.stringify(exportPayload, null, 2);
  const fileName = `glix_export_${new Date().toISOString().split('T')[0]}.json`;
  const fileUri = `${FileSystem.cacheDirectory}${fileName}`;

  // Write to cache
  await FileSystem.writeAsStringAsync(fileUri, jsonString, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  // Check sharing is available (always true on real devices)
  const sharingAvailable = await Sharing.isAvailableAsync();
  if (!sharingAvailable) {
    Alert.alert(
      'Sharing not available',
      `Your export was saved to the app cache at:\n${fileUri}`
    );
    return;
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'Export Glix Data',
    UTI: 'public.json',
  });
}
