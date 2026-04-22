// src/background/index.ts
// Background service worker entry point.
//
// This file contains ONLY event registration and top-level orchestration.
// All business logic lives in the specialized modules:
//
//   timeTracker.ts   → event-driven state machine (YT_PLAY / YT_PAUSE / etc.)
//   dateReset.ts     → daily usage reset
//   limitEnforcer.ts → LimitState computation and broadcast
//   storage.ts       → chrome.storage.local typed wrapper
//
// ─── Event sources handled ────────────────────────────────────────────────
//
//   chrome.runtime.onInstalled  → bootstrap (first install + updates)
//   chrome.runtime.onStartup    → bootstrap (browser launch)
//   chrome.alarms.onAlarm       → periodic flush every ~60 s
//   chrome.runtime.onMessage    → YT_* events from content scripts +
//                                  REQUEST_LIMIT_STATE from content init
//
// ─── What was removed vs the old model ───────────────────────────────────
//
// Tab tracking (onActivated / onUpdated / onFocusChanged) is gone.
// The content script now drives all tracking via explicit YT_PLAY / YT_PAUSE
// messages. Background no longer needs to know which tab is active.

import { CONSTANTS } from '../shared/types';
import { readAll, readTrackingState, writeTrackingState } from '../shared/storage';
import { checkAndResetIfNewDay } from './dateReset';
import {
  onPlaybackStart,
  onPlaybackPause,
  onHeartbeat,
  onAlarmFlush,
} from './timeTracker';
import { computeLimitState, broadcastLimitState } from './limitEnforcer';
import type { ContentToBackgroundMessage, BackgroundToContentMessage, LimitState, TrackingState, Settings } from '../shared/types';

// ─── Broadcast state tracking ─────────────────────────────────────────────

/**
 * The kind of the most recently broadcast LimitState.
 * Used by the YT_HEARTBEAT handler to avoid re-broadcasting when nothing has
 * changed, while still firing promptly when the kind transitions
 * (e.g. 'under' → 'warning') between alarm ticks.
 */
let lastBroadcastKind: LimitState['kind'] | null = null;

/**
 * Computes the current LimitState, broadcasts it to all YouTube tabs, and
 * records the kind so YT_HEARTBEAT can detect kind changes cheaply.
 */
async function broadcastAndTrack(state: TrackingState, settings: Settings): Promise<void> {
  const limitState = computeLimitState(state, settings);
  await broadcastLimitState(limitState);
  lastBroadcastKind = limitState.kind;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

/**
 * Runs on every service worker startup (install, update, browser launch).
 *
 * Resets daily usage if needed, then ensures the alarm exists.
 * The alarm drives periodic persistence flushes.
 */
async function bootstrap(): Promise<void> {
  await checkAndResetIfNewDay();
  ensureAlarm();
}

/**
 * Creates the recurring alarm if it does not already exist.
 * Idempotent — safe to call on every bootstrap.
 */
function ensureAlarm(): void {
  chrome.alarms.get(CONSTANTS.ALARM_NAME, (existingAlarm) => {
    if (!existingAlarm) {
      chrome.alarms.create(CONSTANTS.ALARM_NAME, {
        delayInMinutes: CONSTANTS.ALARM_PERIOD_MINUTES,
        periodInMinutes: CONSTANTS.ALARM_PERIOD_MINUTES,
      });
    }
  });
}

// ─── Service worker lifecycle ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  bootstrap().catch((err) => console.error('[FocusCat] bootstrap error:', err));
});

chrome.runtime.onStartup.addListener(() => {
  bootstrap().catch((err) => console.error('[FocusCat] bootstrap error:', err));
});

// ─── Alarm tick (periodic persistence) ───────────────────────────────────

/**
 * Fires every ~60 seconds.
 *
 * Execution order per tick:
 *   1. Reset date if midnight was crossed.
 *   2. Flush any un-persisted playback delta (pivot-reset or stale-close).
 *   3. Read fresh state, compute LimitState, broadcast to all YouTube tabs.
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CONSTANTS.ALARM_NAME) return;

  try {
    await checkAndResetIfNewDay();
    await onAlarmFlush();

    const { state, settings } = await readAll();
    if (state !== null) {
      await broadcastAndTrack(state, settings);
    }
  } catch (err) {
    console.error('[FocusCat] Alarm tick error:', err);
  }
});

// ─── Message listener (content → background) ─────────────────────────────

/**
 * Central message handler for all content script → background communication.
 *
 * YT_PLAY / YT_PAUSE / YT_ENDED:
 *   Update TrackingState, then immediately recompute and broadcast LimitState
 *   so the content script sees the updated state without waiting for the
 *   next alarm tick.
 *
 * YT_HEARTBEAT:
 *   Update lastHeartbeatMs. Fire-and-forget — no response needed.
 *
 * REQUEST_LIMIT_STATE:
 *   Content script init. Respond synchronously from storage so newly opened
 *   tabs get the current state immediately, not 60 s later.
 *
 * ADD_EXTENSION_MINUTES:
 *   Adds extensionMs to TrackingState, then rebroadcasts the updated LimitState
 *   so the overlay recedes immediately without waiting for the next alarm tick.
 */
chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: BackgroundToContentMessage | null) => void,
  ) => {
    const message = rawMessage as ContentToBackgroundMessage;

    if (message.type === 'YT_PLAY') {
      const tabId = sender.tab?.id ?? 0;
      onPlaybackStart(tabId)
        .then(async () => {
          const { state, settings } = await readAll();
          if (state !== null) {
            await broadcastAndTrack(state, settings);
          }
        })
        .catch((err) => console.error('[FocusCat] YT_PLAY error:', err));
      return false;
    }

    if (message.type === 'YT_PAUSE' || message.type === 'YT_ENDED') {
      onPlaybackPause()
        .then(async () => {
          const { state, settings } = await readAll();
          if (state !== null) {
            await broadcastAndTrack(state, settings);
          }
        })
        .catch((err) => console.error('[FocusCat] YT_PAUSE/ENDED error:', err));
      return false;
    }

    if (message.type === 'YT_HEARTBEAT') {
      const tabId = sender.tab?.id ?? 0;
      onHeartbeat({
        tabId,
        isPlaying: message.isPlaying ?? true,
        currentTimeSec: message.currentTimeSec ?? 0,
      })
        .then(async () => {
          const { state, settings } = await readAll();
          if (state === null) return;
          const limitState = computeLimitState(state, settings);
          if (limitState.kind !== lastBroadcastKind) {
            await broadcastLimitState(limitState);
            lastBroadcastKind = limitState.kind;
          }
        })
        .catch((err) =>
          console.error('[FocusCat] YT_HEARTBEAT error:', err),
        );
      return false;
    }

    if (message.type === 'REQUEST_LIMIT_STATE') {
      readAll()
        .then(({ state, settings }) => {
          if (state === null) {
            sendResponse(null);
            return;
          }
          const response: BackgroundToContentMessage = {
            type: 'LIMIT_STATE_UPDATE',
            payload: computeLimitState(state, settings),
          };
          sendResponse(response);
        })
        .catch((err) => {
          console.error('[FocusCat] REQUEST_LIMIT_STATE error:', err);
          sendResponse(null);
        });

      // Return true: sendResponse will be called asynchronously.
      return true;
    }

    if (message.type === 'ADD_EXTENSION_MINUTES') {
      const extensionMs = (message.minutes ?? 5) * 60_000;
      readTrackingState()
        .then(async (state) => {
          if (state === null) return;
          const updated = { ...state, extensionMs: (state.extensionMs ?? 0) + extensionMs };
          await writeTrackingState(updated);
          const { settings } = await readAll();
          await broadcastAndTrack(updated, settings);
        })
        .catch((err) => console.error('[FocusCat] ADD_EXTENSION_MINUTES error:', err));
      return false;
    }

    return false;
  },
);
