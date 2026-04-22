// src/background/timeTracker.ts
// Event-driven time tracking state machine for the background service worker.
//
// ─── Design: state in storage, not in memory ──────────────────────────────
//
// Unlike the old model, TrackingState is persisted in chrome.storage.local.
// This means service worker suspension and revival do NOT lose the
// sessionStartTimestamp — so getUsedMs() = accumulatedMs + (now - startedAtMs)
// remains accurate across SW restarts.
//
// ─── Event flow ────────────────────────────────────────────────────────────
//
//   YT_PLAY      → onPlaybackStart(tabId)
//   YT_PAUSE     → onPlaybackPause()
//   YT_ENDED     → onPlaybackPause()  (identical behaviour)
//   YT_HEARTBEAT → onHeartbeat()
//   alarm tick   → onAlarmFlush()     (periodic persistence safety)
//
// ─── Heartbeat staleness guard ─────────────────────────────────────────────
//
// The content script sends YT_HEARTBEAT every HEARTBEAT_INTERVAL_MS (10 s).
// If the alarm fires and lastHeartbeatMs is older than HEARTBEAT_STALE_MS (25 s),
// the content script is assumed dead (tab crash, browser minimize, system
// wake from sleep). The session is closed, capping the delta at lastHeartbeatMs
// to prevent ghost accumulation.
//
// ─── Pivot-reset in onAlarmFlush ──────────────────────────────────────────
//
// After each successful alarm flush, startedAtMs is advanced to now.
// Each ~60-second interval is therefore self-contained: a late alarm
// (e.g., 90 s instead of 60 s) correctly counts 90 s of watch time.

import type { TrackingState } from '../shared/types';
import { CONSTANTS } from '../shared/types';
import { getTodayDateString } from '../shared/timeUtils';
import { readTrackingState, writeTrackingState } from '../shared/storage';

// ─── URL helper ────────────────────────────────────────────────────────────

/**
 * Returns true if the given URL belongs to the primary YouTube domain.
 * Excludes music.youtube.com, studio.youtube.com, etc.
 */
export function isYouTubeTab(url: string | undefined): boolean {
  if (url === undefined || url === '') return false;
  try {
    return new URL(url).hostname === CONSTANTS.YOUTUBE_HOSTNAME;
  } catch {
    return false;
  }
}

// ─── Heartbeat payload ─────────────────────────────────────────────────────

/**
 * Structured payload carried by every YT_HEARTBEAT message.
 * Enables the recovery layer to distinguish playing vs. paused state
 * and to reopen or close sessions without a matching YT_PLAY/YT_PAUSE.
 */
export interface HeartbeatPayload {
  /** Tab ID of the sender — used when recovering a missed YT_PLAY. */
  tabId: number;
  /** True if the video element was playing when the heartbeat fired. */
  isPlaying: boolean;
  /** video.currentTime at the moment of the heartbeat (informational). */
  currentTimeSec: number;
}

// ─── Public event handlers ─────────────────────────────────────────────────

/**
 * Called when the content script detects video.play.
 *
 * Sets startedAtMs = now and records the playing tab.
 * Idempotent: if startedAtMs is already set (already playing), no-ops to
 * prevent resetting the pivot mid-session.
 */
export async function onPlaybackStart(tabId: number): Promise<void> {
  const state = await getOrCreateState();

  // Already playing — don't reset the pivot.
  if (state.startedAtMs !== undefined) return;

  const nowMs = Date.now();
  const updated: TrackingState = {
    ...state,
    startedAtMs: nowMs,
    lastHeartbeatMs: nowMs,
    playingTabId: tabId,
  };
  await writeTrackingState(updated);
}

/**
 * Called when the content script detects video.pause or video.ended.
 *
 * Computes elapsed = now - startedAtMs, adds to accumulatedMs,
 * then clears startedAtMs (session over).
 */
export async function onPlaybackPause(): Promise<void> {
  const state = await getOrCreateState();

  if (state.startedAtMs === undefined) return; // not playing

  const nowMs = Date.now();
  const deltaMs = Math.max(0, nowMs - state.startedAtMs);

  const updated: TrackingState = {
    ...state,
    accumulatedMs: state.accumulatedMs + deltaMs,
    startedAtMs:    undefined,
    lastHeartbeatMs: undefined,
    playingTabId:   undefined,
  };
  await writeTrackingState(updated);
}

/**
 * Called when the content script sends YT_HEARTBEAT.
 *
 * Acts as a recovery layer on top of YT_PLAY / YT_PAUSE:
 *
 *   isPlaying = true, no open session   → missed YT_PLAY: open session now.
 *   isPlaying = true, session open      → normal path: refresh liveness stamp.
 *   isPlaying = false, session open     → missed YT_PAUSE: flush and close.
 *   isPlaying = false, no open session  → no-op.
 *
 * This ensures watch time accumulates correctly even when the overlay pauses
 * the video in Soft mode (where the pause event fires but the heartbeat
 * contradicts it on the next tick) or when YT_PLAY / YT_PAUSE messages are
 * lost due to service worker suspension.
 */
export async function onHeartbeat(payload: HeartbeatPayload): Promise<void> {
  const state = await getOrCreateState();
  const nowMs = Date.now();

  if (payload.isPlaying) {
    if (state.startedAtMs === undefined) {
      // Recover missed YT_PLAY — reopen the session from now.
      const updated: TrackingState = {
        ...state,
        startedAtMs:    nowMs,
        lastHeartbeatMs: nowMs,
        playingTabId:   payload.tabId,
      };
      await writeTrackingState(updated);
      return;
    }

    // Session already open — refresh the liveness timestamp only.
    const updated: TrackingState = {
      ...state,
      lastHeartbeatMs: nowMs,
    };
    await writeTrackingState(updated);
    return;
  }

  // isPlaying === false
  if (state.startedAtMs !== undefined) {
    // Recover missed YT_PAUSE — flush the delta and close the session.
    const deltaMs = Math.max(0, nowMs - state.startedAtMs);
    const updated: TrackingState = {
      ...state,
      accumulatedMs:   state.accumulatedMs + deltaMs,
      startedAtMs:     undefined,
      lastHeartbeatMs: undefined,
      playingTabId:    undefined,
    };
    await writeTrackingState(updated);
    return;
  }

  // Not playing and no open session — nothing to do.
}

/**
 * Called by the alarm handler every ~60 seconds for periodic persistence.
 *
 * If playing and heartbeat is fresh:
 *   - Flushes (now - startedAtMs) to accumulatedMs.
 *   - Resets startedAtMs to now (pivot reset — each interval is self-contained).
 *
 * If heartbeat is stale (content script died / system woke from sleep):
 *   - Ends the session, capping the delta at lastHeartbeatMs.
 *   - Prevents hours of sleep from being credited as watch time.
 */
export async function onAlarmFlush(): Promise<void> {
  const state = await getOrCreateState();

  if (state.startedAtMs === undefined) return; // not playing

  const nowMs = Date.now();
  const heartbeatAgeMs =
    state.lastHeartbeatMs !== undefined
      ? nowMs - state.lastHeartbeatMs
      : Infinity;

  if (heartbeatAgeMs > CONSTANTS.HEARTBEAT_STALE_MS) {
    // Content script is gone — close the session, cap delta at lastHeartbeatMs.
    const cappedEndMs =
      state.lastHeartbeatMs !== undefined ? state.lastHeartbeatMs : nowMs;
    const deltaMs = Math.max(0, cappedEndMs - state.startedAtMs);

    const updated: TrackingState = {
      ...state,
      accumulatedMs: state.accumulatedMs + deltaMs,
      startedAtMs:    undefined,
      lastHeartbeatMs: undefined,
      playingTabId:   undefined,
    };
    await writeTrackingState(updated);
    return;
  }

  // Heartbeat is fresh — flush and pivot-reset.
  const rawDeltaMs = nowMs - state.startedAtMs;

  // Secondary gap guard: discard if delta exceeds MAX_TICK_GAP_MS.
  // This catches edge cases where the heartbeat timestamp itself was
  // preserved across a sleep boundary but startedAtMs was old.
  const deltaMs =
    rawDeltaMs > CONSTANTS.MAX_TICK_GAP_MS ? 0 : Math.max(0, rawDeltaMs);

  const updated: TrackingState = {
    ...state,
    accumulatedMs: state.accumulatedMs + deltaMs,
    startedAtMs: nowMs, // pivot reset
  };
  await writeTrackingState(updated);
}

// ─── Private helpers ───────────────────────────────────────────────────────

/**
 * Reads the current TrackingState from storage, or initializes a fresh
 * record if none exists (first run).
 */
async function getOrCreateState(): Promise<TrackingState> {
  const stored = await readTrackingState();
  if (stored !== null) return stored;

  const fresh: TrackingState = {
    date: getTodayDateString(),
    accumulatedMs: 0,
  };
  await writeTrackingState(fresh);
  return fresh;
}
