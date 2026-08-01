// client-mobile/store/listsStore.ts
// Non-persisted, in-memory Zustand store for user-created lists
// ("Movies2026", etc.) — distinct from watchStore.ts's Watchlist/
// MovieWatchlist ("want to watch" trackers). Kept separate, mirroring
// discoverStore.ts's precedent, rather than growing the already-1300+-line
// persisted store further; there is nothing here worth surviving an app
// restart offline (it's always a cheap, fast re-fetch).

import { create } from 'zustand';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';

export type MediaType = 'tv' | 'movie';

export interface CustomListSummary {
  id: number;
  name: string;
  description: string;
  is_private: boolean;
  item_count: number;
  /** Per-media-type breakdown, powers the All/Shows/Movies filter on the
   *  "My Lists" hub — a list can hold both, so item_count alone can't. */
  tv_count: number;
  movie_count: number;
  cover_posters: string[];
  created_at: string;
  updated_at: string;
}

export interface CustomListItem {
  id: number;
  media_type: MediaType;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  added_at: string;
}

export interface CustomListDetail extends CustomListSummary {
  items: CustomListItem[];
}

interface ListsStoreState {
  lists: CustomListSummary[];
  isLoadingLists: boolean;
  activeListDetail: CustomListDetail | null;
  isLoadingListDetail: boolean;
  /** Which of the user's lists contain the item currently open in
   *  AddToListSheet — keyed so switching sheets/items never shows stale
   *  checkmarks from whatever was open before. */
  membership: Record<string, number[]>;
  error: string | null;

  fetchLists: () => Promise<void>;
  createList: (name: string, description?: string, isPrivate?: boolean) => Promise<CustomListSummary | null>;
  renameList: (listId: number, name: string) => Promise<boolean>;
  deleteList: (listId: number) => Promise<boolean>;
  fetchListDetail: (listId: number) => Promise<void>;
  fetchMembership: (mediaType: MediaType, tmdbId: number) => Promise<void>;
  toggleListItem: (listId: number, mediaType: MediaType, tmdbId: number) => Promise<boolean>;
}

function membershipKey(mediaType: MediaType, tmdbId: number) {
  return `${mediaType}:${tmdbId}`;
}

export const useListsStore = create<ListsStoreState>()((set, get) => ({
  lists: [],
  isLoadingLists: false,
  activeListDetail: null,
  isLoadingListDetail: false,
  membership: {},
  error: null,

  fetchLists: async () => {
    set({ isLoadingLists: true, error: null });
    try {
      const response = await api.get<CustomListSummary[]>('/lists/');
      set({ lists: response.data, isLoadingLists: false });
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingLists: false });
    }
  },

  createList: async (name, description, isPrivate = true) => {
    try {
      const response = await api.post<CustomListSummary>('/lists/', {
        name,
        description,
        is_private: isPrivate,
      });
      set((state) => ({ lists: [response.data, ...state.lists] }));
      return response.data;
    } catch (error) {
      set({ error: extractErrorMessage(error) });
      return null;
    }
  },

  renameList: async (listId, name) => {
    const previous = get().lists;
    set({
      lists: previous.map((l) => (l.id === listId ? { ...l, name } : l)),
    });
    try {
      await api.patch(`/lists/${listId}/`, { name });
      return true;
    } catch (error) {
      set({ lists: previous, error: extractErrorMessage(error) });
      return false;
    }
  },

  deleteList: async (listId) => {
    const previous = get().lists;
    set({ lists: previous.filter((l) => l.id !== listId) });
    try {
      await api.delete(`/lists/${listId}/`);
      return true;
    } catch (error) {
      set({ lists: previous, error: extractErrorMessage(error) });
      return false;
    }
  },

  fetchListDetail: async (listId) => {
    set({ isLoadingListDetail: true, error: null });
    try {
      const response = await api.get<CustomListDetail>(`/lists/${listId}/`);
      set({ activeListDetail: response.data, isLoadingListDetail: false });
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingListDetail: false });
    }
  },

  fetchMembership: async (mediaType, tmdbId) => {
    try {
      const response = await api.get<{ list_ids: number[] }>('/lists/membership/', {
        params: { media_type: mediaType, tmdb_id: tmdbId },
      });
      set((state) => ({
        membership: { ...state.membership, [membershipKey(mediaType, tmdbId)]: response.data.list_ids },
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error) });
    }
  },

  toggleListItem: async (listId, mediaType, tmdbId) => {
    const key = membershipKey(mediaType, tmdbId);
    const previousIds = get().membership[key] ?? [];
    const wasIn = previousIds.includes(listId);
    // Optimistic — the sheet's checkmark flips immediately.
    const optimisticIds = wasIn ? previousIds.filter((id) => id !== listId) : [...previousIds, listId];
    set((state) => ({ membership: { ...state.membership, [key]: optimisticIds } }));
    const delta = wasIn ? -1 : 1;
    const countField = mediaType === 'tv' ? 'tv_count' : 'movie_count';
    set((state) => ({
      lists: state.lists.map((l) =>
        l.id === listId ? { ...l, item_count: l.item_count + delta, [countField]: l[countField] + delta } : l
      ),
    }));

    try {
      await api.post('/lists/items/toggle/', { list_id: listId, media_type: mediaType, tmdb_id: tmdbId });
      return true;
    } catch (error) {
      set((state) => ({
        membership: { ...state.membership, [key]: previousIds },
        lists: state.lists.map((l) =>
          l.id === listId ? { ...l, item_count: l.item_count - delta, [countField]: l[countField] - delta } : l
        ),
        error: extractErrorMessage(error),
      }));
      return false;
    }
  },
}));
