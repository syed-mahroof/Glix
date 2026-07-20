// client-mobile/lib/genres.ts
// Canonical TMDB genre id/name/color lists — single source of truth shared
// by DiscoverFilterSheet.tsx (Filter & Sort sheet) and GenreGrid.tsx
// (Browse by Genre tiles). Previously each defined its own separate list;
// GenreGrid's was movie-only genre IDs shown regardless of whether the
// user was on the Shows or Movies segment, so a TV-segment tap could send
// a movie-only genre id (e.g. Horror=27, which isn't a TV genre) into the
// TV discover endpoint. IDs mirror the backend's DiscoverGenresView
// (backend/core/views.py) exactly, so a genre tapped here matches the
// same TMDB genre id end to end.

export interface GenreDef {
  id: number;
  name: string;
  color: string;
}

export const TV_GENRES: GenreDef[] = [
  { id: 10759, name: 'Action & Adventure', color: '#ff4d4d' },
  { id: 16, name: 'Animation', color: '#4d94ff' },
  { id: 35, name: 'Comedy', color: '#ffd700' },
  { id: 80, name: 'Crime', color: '#888888' },
  { id: 99, name: 'Documentary', color: '#4db8ff' },
  { id: 18, name: 'Drama', color: '#b366ff' },
  { id: 10751, name: 'Family', color: '#ffb366' },
  { id: 10762, name: 'Kids', color: '#66ff99' },
  { id: 9648, name: 'Mystery', color: '#6666ff' },
  { id: 10763, name: 'News', color: '#cccccc' },
  { id: 10764, name: 'Reality', color: '#ff66cc' },
  { id: 10765, name: 'Sci-Fi & Fantasy', color: '#33ccff' },
  { id: 10766, name: 'Soap', color: '#ff9999' },
  { id: 10767, name: 'Talk', color: '#ffcc66' },
  { id: 10768, name: 'War & Politics', color: '#996633' },
  { id: 37, name: 'Western', color: '#cc9966' },
];

export const MOVIE_GENRES: GenreDef[] = [
  { id: 28, name: 'Action', color: '#ff4d4d' },
  { id: 12, name: 'Adventure', color: '#ffa64d' },
  { id: 16, name: 'Animation', color: '#4d94ff' },
  { id: 35, name: 'Comedy', color: '#ffd700' },
  { id: 80, name: 'Crime', color: '#888888' },
  { id: 99, name: 'Documentary', color: '#4db8ff' },
  { id: 18, name: 'Drama', color: '#b366ff' },
  { id: 10751, name: 'Family', color: '#ffb366' },
  { id: 14, name: 'Fantasy', color: '#cc33ff' },
  { id: 36, name: 'History', color: '#cc9933' },
  { id: 27, name: 'Horror', color: '#ff1a1a' },
  { id: 10402, name: 'Music', color: '#ff66ff' },
  { id: 9648, name: 'Mystery', color: '#6666ff' },
  { id: 10749, name: 'Romance', color: '#ff6699' },
  { id: 878, name: 'Sci-Fi', color: '#33ccff' },
  { id: 53, name: 'Thriller', color: '#cc0000' },
];
