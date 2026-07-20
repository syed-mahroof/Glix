# Glix — AI Operating Rules

**Purpose:** This document is the mandatory system prompt for any AI agent (human-directed or autonomous) working on the Glix repository. It is not optional context — it is a binding operating contract. Any agent that violates these rules is producing work that will be rejected.

**Audience:** AI coding agents (Antigravity, Claude, or any other tool) operating directly on the Glix monorepo.

---

## 0. MANDATORY FIRST STEP — DO NOT SKIP

Before writing a single line of code, editing a single file, or making any architectural decision, you MUST read these four files in this exact order:

1. `CONTEXT.md` — current architecture, file inventory, API surface, what exists.
2. `ROADMAP.md` — checklist of completed/partial/missing work, completion percentages.
3. `PROJECT_STATUS.md` — current phase, last completed file, current blockers, next planned work.
4. `AUDIT.md` — known bugs, categorized by severity, resolved vs. outstanding.

**These four files are the single source of truth for repository state.** Do not rely on:
- Prior conversation memory (yours or another agent's).
- Assumptions about what "should" exist based on the phase name.
- Training knowledge about how a typical Django/Expo app is structured — this one has specific, established conventions documented below and in `ARCHITECTURE_DECISIONS.md`.

If the four documents conflict with what you find in the actual repository files, **the actual repository files win**. Documentation can drift; source code is ground truth for what currently runs. If you detect drift, correct the documentation as part of your task, not as an afterthought.

---

## 1. Technology Stack (Actual, Verified)

Do not substitute, upgrade, or "improve" any of the following without an explicit instruction to do so. This stack is locked.

### Backend
| Component | Choice | Notes |
|---|---|---|
| Language | Python | 3.12+ (required by Django 6.0.7) |
| Framework | Django | 6.0.7 (pinned, verified installed) |
| API layer | Django REST Framework | 3.17.1 (pinned, verified installed) |
| Auth | djangorestframework-simplejwt | 5.5.1 (pinned, verified installed) — JWT, `Bearer` scheme, access 60min / refresh 30 days, rotation + blacklist enabled |
| CORS | django-cors-headers | 4.9.0 (pinned, verified installed) — wired into `INSTALLED_APPS`/`MIDDLEWARE` |
| Database | PostgreSQL | via `psycopg2-binary` 2.9.12 |
| HTTP client | requests | 2.34.2 — used exclusively inside `core/services.py`'s `TMDBService` |
| Background jobs | Celery + Redis | `backend/config/celery.py` is the app instance; `backend/config/__init__.py` imports it so `@shared_task` in `core/tasks.py` binds correctly |
| External API | TMDB v3 | proxied and cached — **never call TMDB directly from a view; always go through `TMDBService`** |

### Frontend
| Component | Choice | Notes |
|---|---|---|
| Framework | Expo | SDK 54 (`~54.0.34`) |
| UI runtime | React | 19.1.0 |
| Native runtime | React Native | 0.81.5 |
| Language | TypeScript | `~5.9.2`, strict typing throughout |
| Navigation | Expo Router | file-based routing under `client-mobile/app/` |
| Navigation utils | `@react-navigation/native` | required peer for theming (`DarkTheme`/`ThemeProvider`) |
| State | Zustand | single global store at `client-mobile/store/watchStore.ts` |
| HTTP client | Axios | single shared instance at `client-mobile/lib/api.ts` with a 401 refresh-and-retry interceptor |
| Icons | lucide-react-native | the only icon library used — do not introduce a second one |
| Images | expo-image | the only image component used for remote/TMDB images — do not fall back to RN's built-in `Image` |
| Vector graphics | react-native-svg | used by `ProgressRing.tsx` |
| Blur | expo-blur | used for tab bar background and glass overlays |
| Secure storage | expo-secure-store | JWT token storage (`access_token`, `refresh_token`) |
| Safe areas | react-native-safe-area-context | every screen wraps content in `SafeAreaView` |
| Gestures | react-native-gesture-handler | root-wraps the app in `_layout.tsx` |

**Known gap, not yet closed as of the current phase:** several of the packages above are used throughout the codebase but are not yet present in `package.json`. Check `ROADMAP.md`'s "Dependencies (Frontend)" section for the current list before assuming the app builds. Do not silently "fix" this by downgrading or swapping libraries — the fix is adding the missing entries, nothing else.

---

## 2. Design System — Non-Negotiable

Glix's visual identity is "Ultra-Dark Glassmorphism." **As of Phase 12, this expands to an adaptive light/dark system — see §2a — but the identity itself (neon-yellow-on-glass, OLED-black dark mode, hairline borders, this exact radius/motion language) is still locked.** Do not introduce a third color hue, a new border treatment, or a different opacity scale in either theme. If a new screen needs a color not listed here, it must be a variant of one of these (e.g. a translucent red for error states is acceptable; a brand-new blue accent is not).

### Colors (dark theme — the original, still the default)
| Token | Value | Usage |
|---|---|---|
| Base background | `#000000` | Dark theme's root background. Pure black, not near-black. OLED-optimized. |
| Glass fill | `rgba(30, 30, 30, 0.65)` | Every card, composer, chip, modal sheet background |
| Hairline border | `rgba(255, 255, 255, 0.12)` | `StyleSheet.hairlineWidth` on every glass card/container |
| Primary accent | `#E4FA1A` ("Cinema Neon Yellow") | Progress rings, active states, checkmarks, primary buttons, selected chips, liked/favorited icon fill |
| Primary text | `#FFFFFF` | Titles, primary content |
| Secondary text | `rgba(255, 255, 255, 0.55)` to `rgba(255, 255, 255, 0.75)` | Subtitles, metadata, timestamps — opacity varies by hierarchy level, never a different hue |
| Tertiary/disabled text | `rgba(255, 255, 255, 0.35)` to `rgba(255, 255, 255, 0.4)` | Placeholder text, deleted-content markers, disabled labels |
| Error/destructive | `#FF453A` with `rgba(255, 69, 58, 0.14)` fill and `rgba(255, 69, 58, 0.3)` border | Error banners, delete actions — this is the only non-yellow accent color permitted |

### 2a. Adaptive Theming (Phase 12 amendment — explicit sign-off, renegotiates 2 previously-locked tokens)

**What changed and why:** "pitch black `#000000` root background" and "yellow is the only foreground accent" were both listed as absolutely locked pre-Phase 12. The Phase 9/12 design proposal ("Glix · Phase 9 · Design System & Premium Polish") argued the brand should read as "premium in light and dark," not "dark-only." This was accepted — it is the one deliberate exception to the "don't touch locked tokens" rule elsewhere in this document, and it is captured here instead of silently drifting the original table.

**The mechanism — `client-mobile/lib/theme.ts`:** every color is now a token resolved by `useAppTheme()` against a `ThemeName` (`'light' | 'dark'`), not a bare hex/rgba module constant. `store/themeStore.ts` persists the user's `System | Light | Dark` preference; `system` tracks `useColorScheme()` live (no restart needed if the OS flips). **New screens/components must read colors from `useAppTheme().theme.colors`, never hard-code a new `const NEON_YELLOW = '#E4FA1A'`-style constant.** Screens not yet migrated (tracked in `AUDIT.md`) still have hard-coded dark-only constants — that is known debt, not the new standard.

**The accent had to split into two tokens** — `#E4FA1A` as *text* on a white ground is ~1.1:1 contrast, effectively invisible:
- `accentFill` — stays bright `#E4FA1A` in **both** themes. Only ever used as a *fill* paired with dark `onAccent` text (active tab pill, solid buttons). Legible on either ground, so it never changes.
- `accentInk` — the accent as a *foreground* (progress rings, active labels, checkmarks, outline buttons). Bright yellow on dark; a darkened lime `#434F08` (~7:1 on the light ground) on light.

**Light theme is not an inverted flat white** — it keeps the same techniques that make dark read expensive, re-valued: cool-neutral paper ground `#EDEEEA` (faintly accent-biased) with raised near-white cards, inky `#111308` text (not pure black — preserves the "richness"), the same faint ambient accent glow behind hero metrics, a light `BlurView` tint, and soft drop shadows for depth (dark gets depth from a top edge-light + fill gradient instead, since shadows are invisible on `#000`).

**Everything else in §2's table is unchanged and still locked**, including for the light theme: same border-radius range, same hairline-border *treatment* (value differs per theme, see `lib/theme.ts`'s `hairline` token), same two-hue rule (accent + error, no third hue), same component reuse rules (`ProgressRing.tsx`/`SpoilerOverlay.tsx` still the sole implementations, now theme-aware).

### Structural rules
- **Border radius:** cards use 14–20px; small chips/pills use 9–18px; avatars are always fully circular (`borderRadius: size / 2`).
- **Borders:** always `StyleSheet.hairlineWidth`, always `HAIRLINE_BORDER`, never a thicker or colored border except the active-state accent border on selected chips/segments.
- **Blur:** `expo-blur`'s `BlurView` with `intensity={40-60}` and `tint="dark"`, layered *underneath* a `GLASS_FILL` `View` — this two-layer pattern (blur + tint overlay) is used consistently, not blur alone.
- **Buttons (primary):** solid `#E4FA1A` fill, `#000000` text, bold weight.
- **Buttons (secondary/outline):** transparent or glass fill, white/accent border, white or accent text.
- **Progress rings:** `react-native-svg` circles, track in `rgba(255,255,255,0.08)`, progress stroke in `#E4FA1A`, `strokeLinecap="round"`, rotated -90° so progress starts at 12 o'clock. Always use the shared `ProgressRing.tsx` component — never inline a new SVG ring.
- **Spoiler protection:** the shared `SpoilerOverlay.tsx` pattern (dimmed content + blur layer + "tap to reveal" label) is the *only* spoiler-hiding mechanism. Do not build a second one.

---

## 3. Repository-Centric Rules

1. **Analyze before coding.** Read the four core docs (Section 0), then actually open and read the files you intend to touch. Do not assume a file's contents from its name or from what a similar file usually looks like.
2. **Prefer extending existing files over creating duplicates.** If a `TMDBService` method could serve a new need with a parameter added, add the parameter — don't write a second service class. If a serializer could gain a field, add the field — don't write a parallel serializer.
3. **Never move or rename existing files** unless the task explicitly requires it and you document why in `PROJECT_STATUS.md`. Expo Router's file-based routing means a rename *is* a route change — treat it with the same caution as an API contract change.
4. **Never break an existing route.** Before removing or renaming any file under `client-mobile/app/`, grep the entire `client-mobile/` tree for `router.push`, `router.replace`, and `<Link href=` references to that path. Update every caller in the same change.
5. **Never break an existing API contract.** Before changing a serializer's output shape or a view's response shape, grep the entire `client-mobile/` tree for consumers of that endpoint. A backend response shape change is a two-repo change, not a one-repo change.
6. **One model, one migration story.** After any `models.py` change, the task is not complete until `python manage.py makemigrations` has been run (or explicitly flagged as pending in `PROJECT_STATUS.md` if you cannot run it in your environment).
7. **Match existing naming conventions exactly:**
   - Backend views: `<Noun><Verb>View` (e.g. `WatchStateToggleView`, `CommentLikeToggleView`).
   - Backend serializers: `<Noun>Serializer`.
   - Frontend components: PascalCase, one component per file, file name matches export name.
   - Frontend screens: lowercase route segments, `[param].tsx` for dynamic segments, grouped routes in `(tabs)/`.
8. **Respect the presence-based pattern.** Several models (`WatchState`, `CommentLike`) use row-existence as a boolean rather than a boolean field — this is intentional (see `ARCHITECTURE_DECISIONS.md`). Follow this pattern for any new toggle-style relationship rather than introducing a boolean flag.
9. **Respect the soft-delete pattern for anything with replies/threads.** `Comment.is_deleted` + `deleted_at` is the model; never hard-delete a row that other rows reference via FK.
10. **All new list endpoints must paginate** using `core/pagination.py`'s `StandardResultsPagination` (or explicitly justify why not, e.g. a capped "top 10" rail like Continue Watching).
11. **All new frontend network calls must go through `client-mobile/lib/api.ts`'s `api` instance**, never a bare `axios.create()`. Use `client-mobile/lib/errors.ts`'s `extractErrorMessage` for any user-facing error text.
12. **TMDB is only ever called from `core/services.py`.** No view, serializer, or task should import `requests` and hit TMDB directly.

---

## 4. Documentation Is Not Optional

**After ANY code edits or phase completions, you MUST immediately update `CONTEXT.md`, `ROADMAP.md`, `PROJECT_STATUS.md`, and `AUDIT.md`.**

This is not a courtesy — it is the mechanism by which the next agent (which may not share your context, memory, or session) knows what is real. An agent that writes code but does not update these four files has left the repository in a state that will cause the next agent to hallucinate, duplicate work, or break something that was already fixed.

Minimum required updates per file, every time:
- **`CONTEXT.md`** — folder structure tree, API table, model list, component list, screen list must reflect exactly what exists after your change. Remove entries for anything you deleted; add entries for anything you created.
- **`ROADMAP.md`** — flip `⬜`/`🟨` to `✅` for anything you completed; recompute the percentage tables.
- **`PROJECT_STATUS.md`** — update "Current Phase," "Last Completed File," "Current Incomplete File" (or mark the phase complete), "Known Blockers," and the "Last Updated" timestamp.
- **`AUDIT.md`** — mark any issue you fixed as `✅ RESOLVED` (keep the original entry, don't delete it — append the resolution). Add any new issue you discovered, categorized `🔴`/`🟠`/`🟡`/`🟢`.

If you run out of output budget mid-task, finish the file you are currently writing, then update at minimum `PROJECT_STATUS.md`'s "Current Incomplete File" field before stopping, so the handoff point is unambiguous.

---

## 5. What "Done" Means

A task is not complete when the code compiles in your head. It is complete when:
1. Every import resolves against files that actually exist.
2. Every new route is reachable from somewhere a user can actually tap (no orphaned screens — see `AUDIT.md`'s history of dead tab links for why this matters).
3. Every backend change that touches `models.py` has a corresponding migration state noted.
4. The four core docs are updated per Section 4.
5. You have explicitly stated, in your response, anything you deliberately left out of scope — not just gone silent about it.

---

## 6. Failure Modes to Avoid (Observed in This Repository's History)

These are real issues that occurred during Glix's development. Do not repeat them:

- **Silent breaking changes from pagination.** When `WatchlistView`'s response shape changed from a flat array to a paginated `{results: [...]}` envelope, two frontend screens (`(tabs)/index.tsx`, `(tabs)/upcoming.tsx`) were not updated in the same pass and broke silently. **Any backend response-shape change must be paired with every frontend consumer in the same change.**
- **Route/tab-name mismatches.** Expo Router tab names must exactly match file locations relative to the `(tabs)/` group. A screen built at the wrong path (e.g. `app/upcoming.tsx` instead of `app/(tabs)/upcoming.tsx`) produces a tab that silently 404s rather than an error at build time. Always verify file location against the `Tabs.Screen name=` value.
- **New screens with no entry point.** A screen can be perfectly built and still be unreachable if nothing links to it. When adding a screen, explicitly verify (and state) the tap path a real user takes to reach it.
- **Documentation drift from parallel sessions.** If multiple agents or sessions touch this repository, treat the actual files as ground truth over any single document. State explicitly when you find drift rather than silently reconciling it.