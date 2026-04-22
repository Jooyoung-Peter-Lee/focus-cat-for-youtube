// src/content/youtube/navigationWatcher.ts
// Detects YouTube SPA navigations via four layered signals and notifies subscribers.
//
// ─── Detection layers ─────────────────────────────────────────────────────
//
// A) yt-navigate-finish + yt-page-data-updated
//    YouTube's own Polymer router dispatches these on `document` after every
//    SPA navigation. They cross the content-script / page-world boundary as
//    standard DOM events, so no script injection is needed.
//    yt-navigate-finish fires after the new page's data is ready (most reliable).
//    yt-page-data-updated is an earlier signal; both are listened to for coverage.
//
// B) history.pushState / history.replaceState interception
//    Wraps both methods to detect the URL change at the instant it is committed,
//    before YouTube dispatches its own events. Original references are saved and
//    restored exactly on destroyNavigationWatcher(), leaving no permanent mutation.
//
// C) popstate
//    Fires on browser back/forward navigation. YouTube occasionally handles
//    these without dispatching yt-navigate-finish, making this layer necessary.
//
// D) 500 ms setInterval fallback
//    Safety net for rare YouTube A/B routing variants or future changes that
//    bypass all event-based signals. Does a single string comparison per tick;
//    negligible overhead.
//
// ─── Convergence & deduplication ─────────────────────────────────────────
//
// All four layers call handlePotentialNavigation(), which:
//   1. Short-circuits immediately if location.href has not changed.
//   2. Cancels any in-flight debounce and schedules a new one (150 ms).
//
// The debounced fireCallback() reads location.href at settle time, compares
// against lastKnownUrl, updates it, then calls the registered callback once.
// This ensures burst signals (e.g., pushState + yt-navigate-finish for the
// same navigation) coalesce into exactly one callback invocation.

// ─── Types ─────────────────────────────────────────────────────────────────

type NavigationCallback = (newUrl: string) => void;

// ─── Constants ─────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 150;
const FALLBACK_INTERVAL_MS = 500;

// ─── Module state ──────────────────────────────────────────────────────────
//
// All state is module-scoped (singleton). A content script runs as a single
// instance per page, so there is no need for a class-based instance model.

let onNavigate: NavigationCallback | null = null;
let lastKnownUrl = '';
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let fallbackIntervalId: ReturnType<typeof setInterval> | null = null;

// Exact original History method references saved before patching.
// Storing the unbound function (not .bind()) means we restore the exact
// original reference, leaving history.pushState / history.replaceState
// byte-for-byte identical to before init was called.
let savedPushState: typeof history.pushState | null = null;
let savedReplaceState: typeof history.replaceState | null = null;

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Starts all four navigation-detection layers.
 *
 * The provided callback is invoked (debounced at 150 ms) every time
 * location.href changes. It receives the new URL string.
 *
 * Safe to call once per content script lifetime. Subsequent calls without
 * an intervening destroyNavigationWatcher() are no-ops with a console warning.
 */
export function initNavigationWatcher(callback: NavigationCallback): void {
  if (onNavigate !== null) {
    console.warn('[FocusCat] NavigationWatcher already initialised — call destroyNavigationWatcher() first.');
    return;
  }

  onNavigate    = callback;
  lastKnownUrl  = location.href;

  // A) YouTube custom router events
  document.addEventListener('yt-navigate-finish',   handlePotentialNavigation);
  document.addEventListener('yt-page-data-updated', handlePotentialNavigation);

  // B) History API interception
  patchHistoryMethods();

  // C) Browser back / forward
  window.addEventListener('popstate', handlePotentialNavigation);

  // D) 500 ms URL-change fallback
  fallbackIntervalId = setInterval(handlePotentialNavigation, FALLBACK_INTERVAL_MS);
}

/**
 * Tears down all four detection layers and restores the native History API.
 * Safe to call even if initNavigationWatcher() was never called.
 */
export function destroyNavigationWatcher(): void {
  // A)
  document.removeEventListener('yt-navigate-finish',   handlePotentialNavigation);
  document.removeEventListener('yt-page-data-updated', handlePotentialNavigation);

  // B)
  restoreHistoryMethods();

  // C)
  window.removeEventListener('popstate', handlePotentialNavigation);

  // D)
  if (fallbackIntervalId !== null) {
    clearInterval(fallbackIntervalId);
    fallbackIntervalId = null;
  }

  // Cancel any pending debounce so the callback is not invoked after teardown.
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  onNavigate   = null;
  lastKnownUrl = '';
}

// ─── Core signal handler ───────────────────────────────────────────────────

/**
 * Called by every detection layer on every potential navigation signal.
 *
 * Fast path: if the URL has not changed, returns immediately (O(1) string
 * comparison — safe to call from the 500 ms interval without overhead).
 *
 * Otherwise, cancels the in-flight debounce (if any) and schedules a fresh
 * one. Burst signals for the same navigation cancel-and-reschedule each
 * other until they settle, then exactly one callback fires.
 */
function handlePotentialNavigation(): void {
  if (location.href === lastKnownUrl) return;

  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fireCallback, DEBOUNCE_MS);
}

/**
 * Invoked once per navigation after the debounce settles.
 *
 * Re-reads location.href at fire time (the URL may have changed again during
 * the debounce window) and guards against the edge case where the URL reverted
 * before the timer fired (rare but theoretically possible).
 */
function fireCallback(): void {
  debounceTimer = null;

  const url = location.href;
  if (url === lastKnownUrl) return; // URL reverted during debounce window

  lastKnownUrl = url;

  if (onNavigate === null) return;

  try {
    onNavigate(url);
  } catch (err) {
    console.error('[FocusCat] NavigationWatcher callback error:', err);
  }
}

// ─── History API interception ──────────────────────────────────────────────

/**
 * Replaces history.pushState and history.replaceState with thin wrappers that
 * call the original first (preserving all native semantics), then trigger
 * handlePotentialNavigation(). The exact original references are saved so
 * restoreHistoryMethods() can undo the patch with surgical precision.
 *
 * Guard: if savedPushState is already set, the patch has been applied —
 * return early to prevent double-patching (which would chain wrappers and
 * make restoration incorrect).
 */
function patchHistoryMethods(): void {
  if (savedPushState !== null) return;

  savedPushState    = history.pushState;
  savedReplaceState = history.replaceState;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history.pushState = function patchedPushState(data: any, unused: string, url?: string | URL | null): void {
    // Call original with correct `this` so all native side-effects apply.
    savedPushState!.call(history, data, unused, url);
    handlePotentialNavigation();
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history.replaceState = function patchedReplaceState(data: any, unused: string, url?: string | URL | null): void {
    savedReplaceState!.call(history, data, unused, url);
    handlePotentialNavigation();
  };
}

/**
 * Restores history.pushState and history.replaceState to their exact saved
 * references. After this call, the History API is indistinguishable from its
 * pre-patch state from any other extension or page script's perspective.
 */
function restoreHistoryMethods(): void {
  if (savedPushState !== null) {
    history.pushState = savedPushState;
    savedPushState    = null;
  }
  if (savedReplaceState !== null) {
    history.replaceState = savedReplaceState;
    savedReplaceState    = null;
  }
}
