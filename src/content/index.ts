// src/content/index.ts
// Content script entry point — runs on every www.youtube.com page load.
//
// Responsibilities:
//   1. Apply DOM cleaning (hide recommendations, Shorts, etc.).
//   2. Wire SPA navigation detection → DOM re-cleaning, video re-detection,
//      and overlay reattach (requestReattach).
//   3. Wire #movie_player detection → overlay reattach (requestReattach).
//   4. Detect <video> element and attach play/pause/ended event listeners.
//   5. Send YT_PLAY / YT_PAUSE / YT_ENDED messages to background.
//   6. Send YT_HEARTBEAT every 10 s while playing.
//   7. Request the current LimitState from the background on init.
//   8. Listen for SETTINGS_UPDATE → re-apply DOM cleaning.
//
// Overlay management is fully delegated to:
//   overlayController — state machine, owns LIMIT_STATE_UPDATE and storage listeners
//   overlayView       — DOM mounting/unmounting (driven by controller)
//   navigationWatcher — SPA navigation signals → requestReattach()
//   playerWatcher     — #movie_player DOM lifecycle → requestReattach()

import { readSettings } from '../shared/storage';
import { applyCleaning } from './domCleaner';
import { CONSTANTS } from '../shared/types';
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  Settings,
} from '../shared/types';
import {
  initOverlayController,
  destroyOverlayController,
  updateOverlayState,
  requestReattach,
} from './overlay/overlayController';
import {
  initNavigationWatcher,
  destroyNavigationWatcher,
} from './youtube/navigationWatcher';
import {
  initPlayerWatcher,
  destroyPlayerWatcher,
} from './youtube/playerWatcher';

// ─── Module state ──────────────────────────────────────────────────────────

let currentSettings: Settings | null = null;

// Video tracking
let currentVideo: HTMLVideoElement | null = null;
let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;

// ─── Messaging helpers ─────────────────────────────────────────────────────

function sendMessage(msg: ContentToBackgroundMessage): void {
  if (!chrome.runtime?.id) return;
  try {
    chrome.runtime.sendMessage(msg).catch(() => {
      // Background SW may be suspended momentarily — message is best-effort.
    });
  } catch (err) {
    console.warn('[FocusCat] Extension context invalidated, message dropped:', msg.type);
  }
}

// ─── Heartbeat ─────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  if (heartbeatIntervalId !== null) return; // already running
  heartbeatIntervalId = setInterval(() => {
    const video = currentVideo;
    sendMessage({
      type: 'YT_HEARTBEAT',
      isPlaying: video ? !video.paused : false,
      currentTimeSec: video ? video.currentTime : 0,
    });
  }, CONSTANTS.HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat(): void {
  if (heartbeatIntervalId === null) return;
  clearInterval(heartbeatIntervalId);
  heartbeatIntervalId = null;
}

// ─── Video event handlers ──────────────────────────────────────────────────

function onVideoPlay(): void {
  sendMessage({ type: 'YT_PLAY' });
  startHeartbeat();
}

function onVideoPause(): void {
  sendMessage({ type: 'YT_PAUSE' });
  stopHeartbeat();
}

function onVideoEnded(): void {
  sendMessage({ type: 'YT_ENDED' });
  stopHeartbeat();
}

// ─── Video element lifecycle ───────────────────────────────────────────────

function attachVideoListeners(video: HTMLVideoElement): void {
  // Guard: already attached to this exact element.
  if (video === currentVideo) return;

  // Detach from any previous video element first.
  detachVideoListeners();

  currentVideo = video;
  video.addEventListener('play',  onVideoPlay);
  video.addEventListener('pause', onVideoPause);
  video.addEventListener('ended', onVideoEnded);

  // If the video is already playing when we attach (e.g., autoplay on load),
  // fire the play handler immediately so background starts tracking.
  if (!video.paused) {
    onVideoPlay();
  }
}

function detachVideoListeners(): void {
  if (currentVideo === null) return;
  currentVideo.removeEventListener('play',  onVideoPlay);
  currentVideo.removeEventListener('pause', onVideoPause);
  currentVideo.removeEventListener('ended', onVideoEnded);
  currentVideo = null;
  stopHeartbeat();
}

/**
 * Finds the YouTube <video> element and attaches event listeners.
 *
 * YouTube renders the video element asynchronously after navigation, so
 * we poll briefly (up to 5 s) before giving up for this route.
 * Called on init and on every SPA route change.
 */
function detectAndAttachVideo(): void {
  const video = document.querySelector<HTMLVideoElement>('#movie_player video');
  if (video !== null) {
    attachVideoListeners(video);
    return;
  }

  // Video not yet in DOM — poll every 200 ms for up to 5 s.
  let attempts = 0;
  const maxAttempts = 25;
  const pollId = setInterval(() => {
    attempts++;
    const v = document.querySelector<HTMLVideoElement>('#movie_player video');
    if (v !== null) {
      clearInterval(pollId);
      attachVideoListeners(v);
    } else if (attempts >= maxAttempts) {
      clearInterval(pollId);
    }
  }, 200);
}

// ─── Message handling ──────────────────────────────────────────────────────

/**
 * Handles SETTINGS_UPDATE messages pushed by the background service worker.
 *
 * LIMIT_STATE_UPDATE is intentionally absent here — overlayController
 * registers its own chrome.runtime.onMessage listener for that message type
 * (in initOverlayController) and calls updateOverlayState() directly.
 * Having a second handler here would cause duplicate processing.
 *
 * The overlayController also reacts to settings changes via its own
 * chrome.storage.onChanged listener, so no explicit forwarding is needed.
 */
function handleBackgroundMessage(rawMessage: unknown): void {
  const message = rawMessage as BackgroundToContentMessage;
  if (message.type === 'SETTINGS_UPDATE') {
    currentSettings = message.payload;
    applyCleaning(currentSettings);
  }
}

// ─── Limit state bootstrap ─────────────────────────────────────────────────

/**
 * Pulls the current LimitState from the background on content script init.
 *
 * chrome.runtime.sendMessage responses are direct return values and do NOT
 * pass through chrome.runtime.onMessage listeners, so the overlayController's
 * listener would never see this response. We forward it manually here.
 *
 * On F5 page reload the service worker may still be waking up, causing the
 * call to fail or return null. A single retry after 1500 ms covers the SW
 * startup window without risking an infinite loop (hasRetried flag).
 */
function requestLimitState(hasRetried = false): void {
  if (!chrome.runtime?.id) return;

  const message: ContentToBackgroundMessage = { type: 'REQUEST_LIMIT_STATE' };
  chrome.runtime.sendMessage(message)
    .then((response: BackgroundToContentMessage | null) => {
      if (response?.type === 'LIMIT_STATE_UPDATE') {
        updateOverlayState(response.payload);
        return;
      }
      // Null or unexpected response — SW may still be initialising its state.
      if (!hasRetried) {
        setTimeout(() => requestLimitState(true), 1500);
      }
    })
    .catch(() => {
      // SW not yet active — retry once after it has had time to wake up.
      if (!hasRetried) {
        setTimeout(() => requestLimitState(true), 1500);
      }
    });
}

// ─── Cleanup ───────────────────────────────────────────────────────────────

/**
 * Full teardown on page unload (tab close or hard navigation away from YouTube).
 * Not called during SPA navigations — the content script persists across routes.
 */
function cleanup(): void {
  destroyOverlayController();
  destroyNavigationWatcher();
  destroyPlayerWatcher();
  detachVideoListeners();
  chrome.runtime.onMessage.removeListener(handleBackgroundMessage);
}

// ─── Init ──────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Resolve settings before touching the DOM.
  currentSettings = await readSettings();

  // 1. Overlay controller — first, so its storage + message listeners are
  //    registered before any navigation or player signals arrive.
  initOverlayController();

  // 2. Navigation watcher — SPA route changes trigger DOM re-cleaning,
  //    video re-detection, and overlay reattach.
  initNavigationWatcher(() => {
    if (currentSettings !== null) {
      applyCleaning(currentSettings);
    }
    detectAndAttachVideo();
    requestReattach();
  });

  // 3. Player watcher — #movie_player appearing or being replaced signals
  //    the controller to remount the overlay onto the new element.
  initPlayerWatcher(() => {
    requestReattach();
  });

  // Apply distraction removal immediately on page load.
  applyCleaning(currentSettings);

  // Register our message listener. SETTINGS_UPDATE only — see handleBackgroundMessage.
  // Must be registered before requestLimitState() to avoid a race where a pushed
  // SETTINGS_UPDATE arrives before the listener is ready.
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Pull current LimitState from background; the direct response bypasses
  // onMessage listeners, so we forward it to the controller manually.
  requestLimitState();

  // Start detecting the video element.
  detectAndAttachVideo();

  // Register cleanup for tab close / hard navigation away from YouTube.
  // { once: true } auto-removes the listener after first fire.
  window.addEventListener('pagehide', cleanup, { once: true });
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

init().catch((err) => console.error('[FocusCat] Content script init error:', err));
