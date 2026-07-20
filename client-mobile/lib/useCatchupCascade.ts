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

import { useCallback, useRef, useState } from 'react';
import { api } from './api';
import { useWatchStore } from '../store/watchStore';

interface CatchupCheckResponse {
  has: boolean;
  ids: number[];
  count: number;
}

interface PendingCatchup {
  showId: number;
  priorIds: number[];
  finalIds: number[];
  count: number;
  showTitle: string;
  episodeLabel: string;
}

const EMPTY_PENDING: PendingCatchup = {
  showId: 0,
  priorIds: [],
  finalIds: [],
  count: 0,
  showTitle: '',
  episodeLabel: '',
};

const FAILED_CHECK: CatchupCheckResponse = { has: false, ids: [], count: 0 };

interface UndoState {
  visible: boolean;
  count: number;
  ids: number[];
}

const EMPTY_UNDO: UndoState = { visible: false, count: 0, ids: [] };

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

  const [visible, setVisible] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [undo, setUndo] = useState<UndoState>(EMPTY_UNDO);
  const pending = useRef<PendingCatchup>(EMPTY_PENDING);

  /** Checks a single episode against the server. Resolves true if the
   *  modal was shown (the caller must NOT toggle immediately); false if
   *  there's nothing to catch up on (or the check itself failed — see
   *  below) and the caller should proceed right away. */
  const checkEpisode = useCallback(
    async (showId: number, episodeId: number, showTitle: string, episodeLabel: string): Promise<boolean> => {
      setIsChecking(true);
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
      } finally {
        setIsChecking(false);
      }

      if (!check.has) return false;
      pending.current = {
        showId,
        priorIds: check.ids,
        finalIds: [episodeId],
        count: check.count,
        showTitle,
        episodeLabel,
      };
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
      setIsChecking(true);
      let check: CatchupCheckResponse;
      try {
        const res = await api.post<CatchupCheckResponse>('/watch-state/catchup-check/', {
          show_id: showId,
          season_number: seasonNumber,
        });
        check = res.data;
      } catch {
        check = FAILED_CHECK;
      } finally {
        setIsChecking(false);
      }

      if (!check.has) return false;
      pending.current = {
        showId,
        priorIds: check.ids,
        finalIds: seasonIds,
        count: check.count,
        showTitle,
        episodeLabel,
      };
      setVisible(true);
      return true;
    },
    []
  );

  const confirm = useCallback(() => {
    setVisible(false);
    const ids = [...pending.current.priorIds, ...pending.current.finalIds];
    onFinalize(ids, true);
    // An Undo affordance only matters for an actual cascade — marking the
    // one episode/season the user directly tapped, with nothing prior, is
    // already a 1-tap undo via the same checkmark/toggle. This is the case
    // that's genuinely hard to reverse by hand (could be dozens of ids).
    if (pending.current.priorIds.length > 0) {
      setUndo({ visible: true, count: ids.length, ids });
    }
  }, [onFinalize]);

  const cancel = useCallback(() => {
    setVisible(false);
    onFinalize(pending.current.finalIds, true);
  }, [onFinalize]);

  const neverForShow = useCallback(() => {
    setVisible(false);
    setCatchupPreference(pending.current.showId, true);
    onFinalize(pending.current.finalIds, true);
  }, [onFinalize, setCatchupPreference]);

  const dismissUndo = useCallback(() => {
    setUndo(EMPTY_UNDO);
  }, []);

  const performUndo = useCallback(() => {
    const ids = undo.ids;
    setUndo(EMPTY_UNDO);
    onFinalize(ids, false);
  }, [undo, onFinalize]);

  return {
    visible,
    isChecking,
    showTitle: pending.current.showTitle,
    episodeLabel: pending.current.episodeLabel,
    previousCount: pending.current.count,
    checkEpisode,
    checkSeason,
    confirm,
    cancel,
    neverForShow,
    undoVisible: undo.visible,
    undoCount: undo.count,
    dismissUndo,
    performUndo,
  };
}
