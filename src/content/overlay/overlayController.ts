// src/content/overlay/overlayController.ts
// Overlay state machine — the single source of truth for whether the Focus Cat
// overlay should be visible and in which mode.
//
// ─── Responsibilities ────────────────────────────────────────────────────
//
//   - Maintain desiredShown and desiredMode as authoritative state.
//   - React to LimitState pushes from the background service worker.
//   - React to settings changes via chrome.storage.onChanged.
//   - Coordinate reattachment after SPA navigation or player DOM replacement
//     by exposing requestReattach() for navigationWatcher and playerWatcher.
//   - Delegate all DOM work to overlayView (never touches the DOM directly).
//
// ─── State ownership ─────────────────────────────────────────────────────
//
//   desiredShown   — true once the limit is exceeded; false when:
//                      a) state drops back to 'under' or 'warning'
//                      b) user clicks "Dismiss for now"
//                      c) destroyOverlayController() is called
//
//   desiredBanner  — true while state is 'warning'; false otherwise.
//                    Drives the banner reattach path in doReattach() so the
//                    banner survives SPA navigations that replace #movie_player
//                    before updateOverlayState() had a chance to mount it.
//
//   desiredMode    — mirrors settings.focusMode; updated reactively on
//                    chrome.storage.onChanged. A mode change while the overlay
//                    is shown triggers an immediate remount with the new mode.
//
//   licenseState   — cached LicenseState; refreshed from LICENSE_STATE storage key.
//
// ─── Message listener note ───────────────────────────────────────────────
//
// The controller registers its own chrome.runtime.onMessage listener for
// LIMIT_STATE_UPDATE. The existing handler in index.ts (legacy overlayManager)
// also listens for this message. In Step 6 (index.ts wiring), that legacy
// handler will be removed and replaced with a call to updateOverlayState()
// from this module, eliminating the duplicate listener.

import type {
  LimitState,
  Settings,
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
} from '../../shared/types';
import { STORAGE_KEYS } from '../../shared/types';
import { readSettings } from '../../shared/storage';
import {
  getLicenseState,
  isProActive,
  type LicenseState,
} from '../../shared/license';
import {
  mountOverlay,
  unmountOverlay,
  isOverlayMounted,
  type OverlayMountOptions,
} from './overlayView';
import { showWarningBanner, hideWarningBanner } from './warningBanner';

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAYER_ID     = 'movie_player';
const REATTACH_DELAY_MS = 100;

// ─── Module state ────────────────────────────────────────────────────────────

/** True when the full overlay should be visible right now. */
let desiredShown = false;

/**
 * True while LimitState is 'warning'. Persists across SPA navigations so
 * doReattach() can remount the banner after #movie_player is replaced.
 */
let desiredBanner = false;

/** The focus mode currently in effect. Updated reactively from storage. */
let desiredMode: 'soft' | 'hard' = 'soft';

/** Cached license state. Refreshed on init and on LICENSE_STATE storage changes. */
let licenseState: LicenseState = { status: 'free' };

/**
 * The most recent 'exceeded' LimitState received from the background.
 * Holds usedMs / limitMs for display. null when state is not 'exceeded'.
 */
let lastExceededState: Extract<LimitState, { kind: 'exceeded' }> | null = null;

/**
 * The most recent 'warning' LimitState received from the background.
 * Holds usedMs / limitMs for remaining-time calculation. null when state
 * is not 'warning'.
 */
let lastWarningState: Extract<LimitState, { kind: 'warning' }> | null = null;

/** Debounce handle for requestReattach(). */
let reattachTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Initialises the overlay controller.
 *
 * 1. Reads current focusMode from chrome.storage.local (SETTINGS key) and
 *    LicenseState from chrome.storage.local (LICENSE_STATE key).
 * 2. Registers a chrome.storage.onChanged listener to keep desiredMode and
 *    licenseState in sync with user preference changes in real-time.
 * 3. Registers a chrome.runtime.onMessage listener for LIMIT_STATE_UPDATE
 *    messages pushed by the background service worker.
 *
 * Must be called once per content script lifetime.
 * Guard: subsequent calls without destroyOverlayController() are silently
 * ignored via the listener identity check in Chrome's listener registry.
 */
export function initOverlayController(): void {
  // Async reads — module defaults are safe until these resolve.
  readSettings()
    .then((settings: Settings) => {
      desiredMode = settings.focusMode;
    })
    .catch((err: unknown) => {
      console.error('[FocusCat] OverlayController: failed to read initial settings:', err);
      // Default 'soft' mode remains in effect — safe fallback.
    });

  getLicenseState()
    .then((state: LicenseState) => {
      licenseState = state;
    })
    .catch((err: unknown) => {
      console.error('[FocusCat] OverlayController: failed to read initial license state:', err);
      // Default { status: 'free' } remains in effect — safe fallback.
    });

  chrome.storage.onChanged.addListener(handleStorageChange);
  chrome.runtime.onMessage.addListener(handleMessage);
}

/**
 * Reacts to a LimitState update from the background service worker.
 *
 * 'exceeded' → show full overlay via debounced reattach.
 * 'warning'  → show warning banner via debounced reattach (SPA-safe).
 * 'under'    → tear down both banner and overlay immediately.
 *
 * Banner mounting is deferred to doReattach() — not performed inline — so
 * the banner survives the race where #movie_player does not exist at the
 * moment this function runs (common during YouTube SPA navigation).
 *
 * Called either by the controller's own message listener or by index.ts.
 */
export function updateOverlayState(limitState: LimitState): void {
  if (limitState.kind === 'exceeded') {
    desiredShown      = true;
    desiredBanner     = false;
    lastExceededState = limitState;
    lastWarningState  = null;
    hideWarningBanner(); // banner yields to the full overlay
    requestReattach();
    return;
  }

  if (limitState.kind === 'warning') {
    desiredShown      = false;
    desiredBanner     = true;
    lastWarningState  = limitState;
    lastExceededState = null;
    unmountOverlay();
    requestReattach(); // deferred — doReattach() mounts once player exists
    return;
  }

  // 'under' — well within limit, no nudge needed
  desiredShown      = false;
  desiredBanner     = false;
  lastExceededState = null;
  lastWarningState  = null;
  unmountOverlay();
  hideWarningBanner();
}

/**
 * Schedules a debounced mount attempt for the overlay or warning banner.
 *
 * Called by:
 *   - updateOverlayState() when state becomes 'exceeded' or 'warning'
 *   - navigationWatcher callback (URL changed → player may have been replaced)
 *   - playerWatcher callback (#movie_player appeared or was replaced)
 *
 * Debounce (REATTACH_DELAY_MS = 100 ms) collapses bursts of concurrent signals
 * (e.g., yt-navigate-finish + pushState + playerWatcher all firing for one
 * navigation) into a single mount attempt after the DOM settles.
 *
 * No-ops when neither the overlay nor banner is desired, so callers need not
 * guard themselves.
 */
export function requestReattach(): void {
  if (!desiredShown && !desiredBanner) return; // nothing to mount

  if (reattachTimer !== null) clearTimeout(reattachTimer);
  reattachTimer = setTimeout(doReattach, REATTACH_DELAY_MS);
}

/**
 * Full teardown. Unmounts overlay, removes all listeners, cancels timers,
 * and resets every state field to its default.
 * Safe to call even if initOverlayController() was never called.
 */
export function destroyOverlayController(): void {
  if (reattachTimer !== null) {
    clearTimeout(reattachTimer);
    reattachTimer = null;
  }

  unmountOverlay();
  hideWarningBanner();

  chrome.storage.onChanged.removeListener(handleStorageChange);
  chrome.runtime.onMessage.removeListener(handleMessage);

  desiredShown      = false;
  desiredBanner     = false;
  desiredMode       = 'soft';
  licenseState      = { status: 'free' };
  lastExceededState = null;
  lastWarningState  = null;
}

// ─── Reattach logic ──────────────────────────────────────────────────────────

/**
 * Executes after the debounce settles.
 *
 * Two mount paths, evaluated in priority order:
 *
 * Banner path (desiredBanner):
 *   - Mounts the warning banner when state is 'warning'.
 *   - showWarningBanner() is idempotent — safe if already visible.
 *   - If player is null, returns early; playerWatcher will call
 *     requestReattach() again when #movie_player appears.
 *
 * Overlay path (desiredShown):
 *   - Guards: not already mounted, lastExceededState present, player exists.
 *   - If player is null, returns early; same playerWatcher retry mechanism.
 */
function doReattach(): void {
  reattachTimer = null;

  // ── Banner path ────────────────────────────────────────────────────────────
  if (desiredBanner && lastWarningState !== null) {
    const player = document.getElementById(PLAYER_ID);
    if (player === null || !player.isConnected) return; // playerWatcher will retry

    const remainingMs = lastWarningState.limitMs - lastWarningState.usedMs;
    showWarningBanner(player, {
      remainingSeconds: Math.max(0, Math.round(remainingMs / 1_000)),
    });
    return;
  }

  // ── Overlay path ───────────────────────────────────────────────────────────
  if (!desiredShown)              return;
  if (isOverlayMounted())         return; // Still visible — nothing to do.
  if (lastExceededState === null)  return; // State reverted during debounce.

  const player = document.getElementById(PLAYER_ID);
  if (player === null)             return; // playerWatcher will retry

  const options: OverlayMountOptions = {
    mode:         desiredMode,
    usedMs:       lastExceededState.usedMs,
    limitMs:      lastExceededState.limitMs,
    proEnabled:   isProActive(licenseState),
    onDismiss:    handleUserDismiss,
    onExtend:     handleUserExtend,
    pauseOnMount: desiredMode === 'hard',
  };

  mountOverlay(player, options);
}

// ─── User action handlers ────────────────────────────────────────────────────

/**
 * Called by overlayView after the user clicks "Dismiss for now".
 * The view has already unmounted the overlay before calling this.
 *
 * Sets desiredShown = false so that requestReattach() no-ops on subsequent
 * navigation signals until the background pushes a new 'exceeded' state.
 */
function handleUserDismiss(): void {
  desiredShown = false;
}

/**
 * Called by overlayView after the user clicks "+ 5 more minutes".
 * The view has already unmounted the overlay before calling this.
 *
 * Sets desiredShown = false optimistically (assume extension succeeds).
 * The background will push an updated LIMIT_STATE_UPDATE; if it remains
 * 'exceeded' (e.g., SW was suspended), updateOverlayState() will re-set
 * desiredShown = true and trigger a fresh reattach automatically.
 */
function handleUserExtend(): void {
  desiredShown = false;

  const message: ContentToBackgroundMessage = {
    type:    'ADD_EXTENSION_MINUTES',
    minutes: 5,
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // Background SW may be temporarily suspended. The extension request will
    // be processed on the next alarm tick when the SW revives.
  });
}

// ─── Storage change handler ───────────────────────────────────────────────────

/**
 * Fired by chrome.storage.onChanged whenever any storage key changes.
 *
 * Watches two keys:
 *   SETTINGS      → extracts focusMode (mode change triggers overlay remount)
 *   LICENSE_STATE → extracts updated license state (pro change triggers remount)
 *
 * If a display-relevant value changes while the overlay is active, unmounts
 * and reschedules a remount so the new config takes effect immediately.
 */
function handleStorageChange(
  changes: { [key: string]: chrome.storage.StorageChange },
  areaName: string,
): void {
  if (areaName !== 'local') return;

  let modeChanged = false;
  let proChanged  = false;

  const settingsChange = changes[STORAGE_KEYS.SETTINGS];
  if (settingsChange?.newValue !== undefined) {
    const next = settingsChange.newValue as Settings;
    if (next.focusMode === 'soft' || next.focusMode === 'hard') {
      modeChanged = next.focusMode !== desiredMode;
      desiredMode = next.focusMode;
    }
  }

  const licenseChange = changes[STORAGE_KEYS.LICENSE_STATE];
  if (licenseChange?.newValue !== undefined) {
    const next = licenseChange.newValue as LicenseState;
    proChanged   = isProActive(next) !== isProActive(licenseState);
    licenseState = next;
  }

  // If a display-relevant setting changed while the overlay is active,
  // unmount and immediately schedule a remount with the updated config.
  // desiredShown remains true, so requestReattach() will proceed.
  if ((modeChanged || proChanged) && desiredShown && isOverlayMounted()) {
    unmountOverlay();
    requestReattach();
  }
}

// ─── Message handler ─────────────────────────────────────────────────────────

/**
 * Handles messages pushed by the background service worker.
 *
 * Only LIMIT_STATE_UPDATE is relevant here; all other message types pass
 * through to other listeners registered on chrome.runtime.onMessage.
 *
 * Returns void (not `true`) — this handler never calls sendResponse.
 */
function handleMessage(rawMessage: unknown): void {
  const message = rawMessage as BackgroundToContentMessage;
  if (message.type === 'LIMIT_STATE_UPDATE') {
    updateOverlayState(message.payload);
  }
}
