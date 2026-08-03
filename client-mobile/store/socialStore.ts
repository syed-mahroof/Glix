// client-mobile/store/socialStore.ts
// Non-persisted, in-memory Zustand store for the follow graph, user
// search, public profiles, and the friends activity feed (Phase 74) —
// mirrors listsStore.ts's precedent rather than growing the already
// 1300+-line persisted watchStore.ts further. Nothing here is worth
// surviving an app restart offline.

import { create } from 'zustand';
import { api } from '../lib/api';
import { extractErrorMessage } from '../lib/errors';

export interface PublicUser {
  id: number;
  username: string;
  profile_picture: string | null;
  is_following: boolean;
  /** True on the viewer's own row in a followers/following list (Phase
   *  75.6) — lets the row hide its Follow button instead of rendering one
   *  that always 400s (Follow's own DB constraint forbids a self-follow
   *  row, so is_following is always false for your own entry). Only ever
   *  populated on FollowEdge rows (followers/following lists); absent
   *  (undefined) on plain search results, which never include your own
   *  account either way. */
  is_self?: boolean;
}

export interface FollowEdge extends PublicUser {
  followed_at: string;
}

export interface TopShow {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  episodes_watched: number;
}

export interface RecentMovie {
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  watched_at: string;
}

export interface PublicListSummary {
  id: number;
  name: string;
  item_count: number;
}

export interface PublicProfile {
  username: string;
  profile_picture: string | null;
  member_since: string;
  total_time_watched: number;
  watched_hours: number;
  earned_badges: string[];
  current_streak: number;
  longest_streak: number;
  shows_tracked: number;
  movies_watched: number;
  episodes_watched: number;
  top_shows: TopShow[];
  recent_movies: RecentMovie[];
  public_lists: PublicListSummary[];
  follower_count: number;
  following_count: number;
  is_self: boolean;
  is_following: boolean;
  follows_you: boolean;
}

// Phase 75.6: was raw watch activity (every episode/movie a followee
// watched — the 'episodes'/'movie' card types this replaced). The feed now
// shows their reviews instead, which is an opinion worth surfacing, not a
// checkbox tick.
export interface ActivityCard {
  type: 'review';
  media_type: 'tv' | 'movie';
  user_id: number;
  username: string;
  profile_picture: string | null;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  rating: number;
  note: string;
  updated_at: string;
}

interface PaginatedResponse<T> {
  count: number;
  total_pages: number;
  current_page: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

function usernameKey(username: string) {
  return username.toLowerCase();
}

interface SocialStoreState {
  searchResults: PublicUser[];
  isSearching: boolean;
  searchError: string | null;

  profiles: Record<string, PublicProfile>;
  isLoadingProfile: boolean;

  followers: Record<string, FollowEdge[]>;
  following: Record<string, FollowEdge[]>;
  isLoadingConnections: boolean;

  activityFeed: ActivityCard[];
  isLoadingFeed: boolean;
  feedPage: number;
  hasMoreFeed: boolean;

  error: string | null;

  searchUsers: (query: string) => Promise<void>;
  clearSearch: () => void;
  fetchProfile: (username: string) => Promise<void>;
  fetchFollowers: (username: string) => Promise<void>;
  fetchFollowing: (username: string) => Promise<void>;
  toggleFollow: (username: string) => Promise<boolean>;
  fetchActivityFeed: (page?: number) => Promise<void>;
}

export const useSocialStore = create<SocialStoreState>()((set, get) => ({
  searchResults: [],
  isSearching: false,
  searchError: null,

  profiles: {},
  isLoadingProfile: false,

  followers: {},
  following: {},
  isLoadingConnections: false,

  activityFeed: [],
  isLoadingFeed: false,
  feedPage: 1,
  hasMoreFeed: true,

  error: null,

  searchUsers: async (query) => {
    const q = query.trim();
    if (q.length < 2) {
      set({ searchResults: [], isSearching: false, searchError: null });
      return;
    }
    set({ isSearching: true, searchError: null });
    try {
      const response = await api.get<PaginatedResponse<PublicUser>>('/users/search/', {
        params: { q },
      });
      set({ searchResults: response.data.results, isSearching: false });
    } catch (error) {
      set({ searchError: extractErrorMessage(error), isSearching: false });
    }
  },

  clearSearch: () => set({ searchResults: [], searchError: null }),

  fetchProfile: async (username) => {
    set({ isLoadingProfile: true, error: null });
    try {
      const response = await api.get<PublicProfile>(`/users/${username}/`);
      set((state) => ({
        profiles: { ...state.profiles, [usernameKey(username)]: response.data },
        isLoadingProfile: false,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingProfile: false });
    }
  },

  fetchFollowers: async (username) => {
    set({ isLoadingConnections: true, error: null });
    try {
      const response = await api.get<PaginatedResponse<FollowEdge>>(`/users/${username}/followers/`);
      set((state) => ({
        followers: { ...state.followers, [usernameKey(username)]: response.data.results },
        isLoadingConnections: false,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingConnections: false });
    }
  },

  fetchFollowing: async (username) => {
    set({ isLoadingConnections: true, error: null });
    try {
      const response = await api.get<PaginatedResponse<FollowEdge>>(`/users/${username}/following/`);
      set((state) => ({
        following: { ...state.following, [usernameKey(username)]: response.data.results },
        isLoadingConnections: false,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingConnections: false });
    }
  },

  toggleFollow: async (username) => {
    const key = usernameKey(username);
    const state = get();

    const applyOptimistic = (nextFollowing: boolean, followerDelta: number) => {
      set((s) => ({
        searchResults: s.searchResults.map((u) =>
          usernameKey(u.username) === key ? { ...u, is_following: nextFollowing } : u
        ),
        profiles: s.profiles[key]
          ? {
              ...s.profiles,
              [key]: {
                ...s.profiles[key],
                is_following: nextFollowing,
                follower_count: s.profiles[key].follower_count + followerDelta,
              },
            }
          : s.profiles,
        followers: Object.fromEntries(
          Object.entries(s.followers).map(([k, edges]) => [
            k,
            edges.map((e) => (usernameKey(e.username) === key ? { ...e, is_following: nextFollowing } : e)),
          ])
        ),
        following: Object.fromEntries(
          Object.entries(s.following).map(([k, edges]) => [
            k,
            edges.map((e) => (usernameKey(e.username) === key ? { ...e, is_following: nextFollowing } : e)),
          ])
        ),
      }));
    };

    const wasFollowing =
      state.profiles[key]?.is_following ??
      state.searchResults.find((u) => usernameKey(u.username) === key)?.is_following ??
      false;

    applyOptimistic(!wasFollowing, wasFollowing ? -1 : 1);

    try {
      const response = await api.post<{ username: string; following: boolean; follower_count: number }>(
        `/users/${username}/follow/`
      );
      set((s) => ({
        profiles: s.profiles[key]
          ? {
              ...s.profiles,
              [key]: {
                ...s.profiles[key],
                is_following: response.data.following,
                follower_count: response.data.follower_count,
              },
            }
          : s.profiles,
      }));
      return true;
    } catch (error) {
      applyOptimistic(wasFollowing, wasFollowing ? 1 : -1);
      set({ error: extractErrorMessage(error) });
      return false;
    }
  },

  fetchActivityFeed: async (page = 1) => {
    set({ isLoadingFeed: true, error: null });
    try {
      const response = await api.get<PaginatedResponse<ActivityCard>>('/feed/activity/', {
        params: { page },
      });
      set((state) => ({
        activityFeed: page === 1 ? response.data.results : [...state.activityFeed, ...response.data.results],
        feedPage: page,
        hasMoreFeed: response.data.next !== null,
        isLoadingFeed: false,
      }));
    } catch (error) {
      set({ error: extractErrorMessage(error), isLoadingFeed: false });
    }
  },
}));
