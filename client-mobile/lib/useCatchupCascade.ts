// client-mobile/lib/useCatchupCascade.ts
// Shared "Catch-Up Modal" decision-tree state machine. Wraps the
// server-authoritative POST /watch-state/catchup-check/ (CatchupCheckView)
// so the check-then-maybe-show-modal flow isn't duplicated at every screen
// that lets a user mark an episode or season watched (Shows Hub row,
// season screen, episode detail screen).
//
// CHANGED: previously called watchStore's hasPreviousUnwatched()/
// hasPreviousUnwatchedForSeason(), which computed the answer purely from
// whatever the Zustand watchlist snapshot happened to already have cached
// client-side — silently incomplete whenever a user jumped straight to a
// later season without first opening the ones before it (live-tested,
// user-reported: marking episode 6 of a season showed no modal at all
// because the check ran, correctly, against an *incomplete* local view).
// checkEpisode/checkSeason are now async and hit the backend, which
// eager-caches any missing earlier season before answering — see
// AUDIT.md for the full root-cause writeup.

import { useCallback, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { isEpisodeWatched, useWatchStore } from '../store/watchStore';

interface CatchupCheckResponse {
  has: boolean;
  ids: number[];
  count: number;
}

interface PendingCatchup {
  showId: number;
  priorIds: number[];
  finalIds: number[];
}

const EMPTY_PENDING: PendingCatchup = {
  showId: 0,
  priorIds: [],
  finalIds: [],
};

const FAILED_CHECK: CatchupCheckResponse = { has: false, ids: [], count: 0 };

/** Bug fix (2026-08-21, "modal pops after the show already shows complete"):
 *  checkEpisode/checkSeason fire un-awaited from the Shows Hub (a real POST
 *  to a Render free-tier dyno can take 20-50s cold), so the server's answer
 *  can land well after the local store has already moved on — most visibly,
 *  after a bulk mark-watched (or another concurrent tap) already caught the
 *  show up. Re-checking each id the server flagged against the CURRENT store
 *  snapshot right before opening the modal means a stale answer degrades to
 *  "nothing left to catch up on" instead of re-litigating episodes the user
 *  can already see marked watched. getState(), not the reactive hook: this
 *  runs after an await, outside any render. */
function filterStillUnwatched(ids: number[]): number[] {
  const watchlist = useWatchStore.getState().watchlist;
  return ids.filter((id) => !isEpisodeWatched(watchlist, id));
}

interface UndoState {
  visible: boolean;
  count: number;
  ids: number[];
}

const EMPTY_UNDO: UndoState = { visible: false, count: 0, ids: [] };

// Display-only fields for the modal. Split out of `pending` (below) and
// held in state rather than a ref: these are read during render by every
// consumer (visible={catchup.visible} showTitle={catchup.showTitle} etc.),
// so they have to be something a render actually observes. `pending` itself
// stays a ref — only confirm/cancel/neverForShow ever read it, and that
// happens inside an event handler, never during render.
interface Prompt {
  showTitle: string;
  episodeLabel: string;
  previousCount: number;
}

/**
 * `onFinalize(ids, watched)` is called with the full list of episode ids to
 * mark and the direction to mark them in. `watched` is always `true` for
 * the three modal outcomes (confirm / cancel / never-for-show); `false` is
 * used by `performUndo` below to reverse a confirmed cascade. Callers only
 * need one "set these ids to this watched state" code path regardless of
 * which button was tapped.
 */
export function useCatchupCascade(onFinalize: (ids: number[], watched: boolean) => void) {
  const setCatchupPreference = useWatchStore((state) => state.setCatchupPreference);

  // Latched so confirm/cancel/neverForShow/checkEpisode/checkSeason can stay
  // referentially stable ([] deps) no matter what the caller passes in —
  // every call site passes an inline arrow or a useCallback whose own deps
  // change often (e.g. index.tsx's watchlist-dependent handlers), and
  // without this, `catchup` itself was a fresh object on every render,
  // which fed straight into FlashList's renderItem and defeated every
  // memo() on the row/card components below it.
  const onFinalizeRef = useRef(onFinalize);
  onFinalizeRef.current = onFinalize;

  const [visible, setVisible] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [undo, setUndo] = useState<UndoState>(EMPTY_UNDO);
  const pending = useRef<PendingCatchup>(EMPTY_PENDING);
  // Bug fix: `pending` is a single slot, but un-awaiting the grid's mark-
  // watched call (Shows Hub perf fix) means checkEpisode/checkSeason can now
  // be re-entered while a previous check is still on the wire or its modal
  // is still up — a second call would silently overwrite `pending` and one
  // of the two cascades would just vanish (no modal, no mark). Any call
  // arriving while either is true proceeds as "nothing to catch up on" for
  // ITS OWN tap rather than touching the slot a prior tap owns; the prior
  // tap's flow is unaffected either way.
  const inFlight = useRef(false);

  /** Checks a single episode against the server. Resolves true if the
   *  modal was shown (the caller must NOT toggle immediately); false if
   *  there's nothing to catch up on (or the check itself failed, or the
   *  single pending slot is already claimed — see above) and the caller
   *  should proceed right away. */
  const checkEpisode = useCallback(
    async (showId: number, episodeId: number, showTitle: string, episodeLabel: string): Promise<boolean> => {
      // `inFlight` stays true from here until confirm/cancel/neverForShow
      // resolves the modal (or the check itself comes back empty, below) —
      // it covers "check is on the wire" AND "modal is up awaiting a
      // decision" as one continuous busy window, so a ref is required here
      // (not `visible` state): this callback has `[]` deps, so a captured
      // `visible` would always read its value from the very first render.
      if (inFlight.current) return false;
      inFlight.current = true;
      let check: CatchupCheckResponse;
      try {
        const res = await api.post<CatchupCheckResponse>('/watch-state/catchup-check/', {
          episode_id: episodeId,
        });
        check = res.data;
      } catch {
        // Best-effort: a failed check (network blip) shouldn't block the
        // user's tap entirely — proceed as "nothing to catch up on" rather
        // than leaving the checkmark stuck with no feedback at all. Worst
        // case the user has to manually mark an earlier episode later.
        check = FAILED_CHECK;
      }

      const priorIds = filterStillUnwatched(check.ids);
      if (!check.has || priorIds.length === 0) {
        inFlight.current = false;
        return false;
      }
      pending.current = { showId, priorIds, finalIds: [episodeId] };
      setPrompt({ showTitle, episodeLabel, previousCount: priorIds.length });
      setVisible(true);
      return true;
    },
    []
  );

  /** Checks earlier seasons only — the target season's own unwatched
   *  episodes (`seasonIds`) are already the caller's responsibility to
   *  mark regardless of the outcome here. */
  const checkSeason = useCallback(
    async (
      showId: number,
      seasonNumber: number,
      seasonIds: number[],
      showTitle: string,
      episodeLabel: string
    ): Promise<boolean> => {
      if (inFlight.current) return false;
      inFlight.current = true;
      let check: CatchupCheckResponse;
      try {
        const res = await api.post<CatchupCheckResponse>('/watch-state/catchup-check/', {
          show_id: showId,
          season_number: seasonNumber,
        });
        check = res.data;
      } catch {
        check = FAILED_CHECK;
      }

      const priorIds = filterStillUnwatched(check.ids);
      if (!check.has || priorIds.length === 0) {
        inFlight.current = false;
        return false;
      }
      pending.current = { showId, priorIds, finalIds: seasonIds };
      setPrompt({ showTitle, episodeLabel, previousCount: priorIds.length });
      setVisible(true);
      return true;
    },
    []
  );

  const confirm = useCallback(() => {
    setVisible(false);
    inFlight.current = false;
    const ids = [...pending.current.priorIds, ...pending.current.finalIds];
    onFinalizeRef.current(ids, true);
    // An Undo affordance only matters for an actual cascade — marking the
    // one episode/season the user directly tapped, with nothing prior, is
    // already a 1-tap undo via the same checkmark/toggle. This is the case
    // that's genuinely hard to reverse by hand (could be dozens of ids).
    if (pending.current.priorIds.length > 0) {
      setUndo({ visible: true, count: ids.length, ids });
    }
  }, []);

  const cancel = useCallback(() => {
    setVisible(false);
    inFlight.current = false;
    onFinalizeRef.current(pending.current.finalIds, true);
  }, []);

  const neverForShow = useCallback(() => {
    setVisible(false);
    inFlight.current = false;
    setCatchupPreference(pending.current.showId, true);
    onFinalizeRef.current(pending.current.finalIds, true);
  }, [setCatchupPreference]);

  const dismissUndo = useCallback(() => {
    setUndo(EMPTY_UNDO);
  }, []);

  const performUndo = useCallback(() => {
    const ids = undo.ids;
    setUndo(EMPTY_UNDO);
    onFinalizeRef.current(ids, false);
  }, [undo]);

  return useMemo(
    () => ({
      visible,
      showTitle: prompt?.showTitle ?? '',
      episodeLabel: prompt?.episodeLabel ?? '',
      previousCount: prompt?.previousCount ?? 0,
      checkEpisode,
      checkSeason,
      confirm,
      cancel,
      neverForShow,
      undoVisible: undo.visible,
      undoCount: undo.count,
      dismissUndo,
      performUndo,
    }),
    [visible, prompt, checkEpisode, checkSeason, confirm, cancel, neverForShow, undo, dismissUndo, performUndo]
  );
}
