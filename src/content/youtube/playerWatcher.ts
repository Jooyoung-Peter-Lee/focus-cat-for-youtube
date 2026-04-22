// src/content/youtube/playerWatcher.ts
// Watches for #movie_player appearing or being replaced in the DOM and
// notifies the caller so the overlay can be reattached to the new element.
//
// ─── Why MutationObserver on documentElement? ────────────────────────────
//
// YouTube's SPA navigation can replace #movie_player at any depth in the
// DOM tree, sometimes inside shadow-like Polymer wrappers. Observing
// document.documentElement with subtree: true guarantees we catch insertions
// at any level without needing to know the exact parent chain.
//
// ─── Performance strategy (no full DOM rescans) ──────────────────────────
//
// A MutationObserver with subtree: true on YouTube's root element fires
// hundreds of times per second during Polymer renders. Full DOM rescans on
// every callback would be prohibitively expensive.
//
// Instead, each MutationRecord's addedNodes list is scanned directly:
//   1. Skip non-Element nodes immediately (text, comment, etc.).
//   2. Check node.id === PLAYER_ID  → O(1), no DOM traversal.
//   3. If not a direct match, call node.querySelector('#movie_player').
//      Browsers implement getElementById/querySelector('#id') via an internal
//      ID hash table — O(1) average even on large subtrees.
//   4. Bail out of both loops the moment a match is found (early return).
//
// No document.getElementById() is called inside the hot MutationObserver
// callback. It is deferred to checkForPlayer(), which runs after the
// 100 ms debounce settles and the DOM is stable.
//
// ─── Replaced-player detection ───────────────────────────────────────────
//
// When YouTube replaces #movie_player (remove + re-insert), the new element
// appears in addedNodes of a subsequent MutationRecord. checkForPlayer()
// compares the resolved element against lastKnownPlayer: if the reference is
// the same DOM node, the callback is suppressed (no real replacement occurred).
// If the reference differs, the callback fires with the new element.
//
// ─── Complement with navigationWatcher ───────────────────────────────────
//
// YouTube sometimes reuses the exact same #movie_player DOM node across SPA
// navigations (updates its content without removing/re-inserting the element).
// In that case addedNodes never fires for the player, so playerWatcher stays
// silent. The navigationWatcher handles that path via URL-change detection.
// Both watchers converge into requestReattach() in the controller, so no
// navigation path is left uncovered.

// ─── Types ─────────────────────────────────────────────────────────────────

type PlayerReadyCallback = (player: HTMLElement) => void;

// ─── Constants ─────────────────────────────────────────────────────────────

const PLAYER_ID = 'movie_player';
const DEBOUNCE_MS = 100;

// ─── Module state ──────────────────────────────────────────────────────────

let onPlayerReady: PlayerReadyCallback | null = null;
let domObserver: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The last #movie_player element passed to the callback.
 * Used to suppress re-firing when the same DOM node is still in place.
 * Reset to null on destroy so the next init always fires fresh.
 */
let lastKnownPlayer: HTMLElement | null = null;

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Starts watching for #movie_player to appear or be replaced.
 *
 * Fires `callback` with the ready HTMLElement after a 100 ms debounce.
 * Also performs an immediate check on init so callers receive the player
 * even when it was already in the DOM before this function was called.
 *
 * Guard: subsequent calls without an intervening destroyPlayerWatcher()
 * are no-ops (logs a warning). This prevents double-observer memory leaks.
 */
export function initPlayerWatcher(callback: PlayerReadyCallback): void {
  if (domObserver !== null) {
    console.warn('[FocusCat] PlayerWatcher already initialised — call destroyPlayerWatcher() first.');
    return;
  }

  onPlayerReady = callback;

  domObserver = new MutationObserver(handleMutations);
  domObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    // attributes / characterData deliberately omitted:
    // we only care about node additions, not attribute changes or text updates.
  });

  // Immediate check: if #movie_player is already in the DOM (e.g., watcher
  // initialised after YouTube's first render), fire the callback right away.
  schedulePlayerCheck();
}

/**
 * Disconnects the MutationObserver, cancels any pending debounce, and
 * resets all module state. Safe to call even before initPlayerWatcher().
 */
export function destroyPlayerWatcher(): void {
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  domObserver?.disconnect();
  domObserver = null;

  onPlayerReady    = null;
  lastKnownPlayer  = null;
}

// ─── MutationObserver callback ────────────────────────────────────────────

/**
 * Hot path — called on every DOM mutation batch by the browser.
 *
 * Scans only addedNodes across all records. For each Element, checks its id
 * first (O(1)) and only falls through to querySelector (O(1) via browser ID
 * table) if the element itself is not the player. Exits both loops immediately
 * on first match to avoid redundant work in large mutation batches.
 *
 * Non-Element nodes (Text, Comment, ProcessingInstruction, etc.) are skipped
 * via an instanceof Element guard — they do not have .id or .querySelector()
 * and would throw a TypeError if accessed.
 */
function handleMutations(records: MutationRecord[]): void {
  for (const record of records) {
    for (const node of Array.from(record.addedNodes)) {
      // Guard: skip Text, Comment, and other non-Element node types.
      if (!(node instanceof Element)) continue;

      try {
        if (node.id === PLAYER_ID || node.querySelector(`#${PLAYER_ID}`) !== null) {
          // Match found — no further scanning needed for this batch.
          schedulePlayerCheck();
          return;
        }
      } catch {
        // Detached or malformed subtree — skip this node and continue scanning.
      }
    }
  }
}

// ─── Debounced player resolution ──────────────────────────────────────────

/**
 * Cancels any in-flight debounce and schedules a fresh one.
 * Multiple rapid mutations (common during YouTube's Polymer re-renders)
 * coalesce into a single checkForPlayer() call after the burst settles.
 */
function schedulePlayerCheck(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(checkForPlayer, DEBOUNCE_MS);
}

/**
 * Resolves #movie_player from the live DOM and fires the callback if the
 * element is present and differs from the last known reference.
 *
 * Called after the 100 ms debounce, when the DOM is expected to be stable.
 * Uses getElementById for the fastest possible ID lookup at resolve time.
 */
function checkForPlayer(): void {
  debounceTimer = null;

  if (onPlayerReady === null) return;

  const player = document.getElementById(PLAYER_ID);

  // Player not (yet) in DOM — wait for a future mutation.
  if (player === null) return;

  // Same DOM node as before — no actual replacement occurred.
  // (Handles Polymer partial re-renders that leave the element in place.)
  if (player === lastKnownPlayer) return;

  lastKnownPlayer = player;

  try {
    onPlayerReady(player);
  } catch (err) {
    console.error('[FocusCat] PlayerWatcher callback error:', err);
  }
}
