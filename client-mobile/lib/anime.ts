// client-mobile/lib/anime.ts
// Shared "is this anime?" heuristic (Phase H, reused by Phase K's Discover
// Hub filter). TMDB has no dedicated "Anime" genre — the documented signal
// used here is the Animation genre combined with Japanese as the original
// language. Deliberate, not incidental: this excludes a Western-produced
// animated show (Animation genre, original_language 'en') and a live-action
// Japanese drama (original_language 'ja', no Animation genre) — both are
// real titles that must NOT match, not gaps in the heuristic.
export function isAnimeByGenresAndLanguage(
  genres: string[],
  originalLanguage: string | null | undefined
): boolean {
  if (originalLanguage !== 'ja') return false;
  return genres.some((g) => g.toLowerCase() === 'animation');
}

/** Movie genres are stored as a comma-separated string (`MovieCache.genres_string`),
 *  not an array like `Show.genres` — split before checking. */
export function isAnimeByGenreStringAndLanguage(
  genresString: string | null | undefined,
  originalLanguage: string | null | undefined
): boolean {
  if (!genresString) return false;
  return isAnimeByGenresAndLanguage(
    genresString.split(',').map((g) => g.trim()),
    originalLanguage
  );
}

/** Animation genre, any language — deliberately broader than the Anime
 *  heuristic above (which additionally requires Japanese). Lets Western
 *  animated movies (Pixar, DreamWorks, adult animated comedies, etc.) be
 *  filtered on their own, distinct from the Anime tag. */
export function hasAnimationGenreString(genresString: string | null | undefined): boolean {
  if (!genresString) return false;
  return genresString.split(',').map((g) => g.trim().toLowerCase()).includes('animation');
}
