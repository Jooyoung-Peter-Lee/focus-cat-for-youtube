// src/shared/timeUtils.ts
// Pure time utility functions. Zero side-effects, zero Chrome API calls.

import type { TrackingState } from './types';
import { CONSTANTS } from './types';

// ─── Date helpers ──────────────────────────────────────────────────────────

/**
 * Returns today's date as a 'YYYY-MM-DD' string in the user's local timezone.
 *
 * Local time is intentional: users expect the daily reset at their own
 * midnight, not UTC midnight.
 */
export function getTodayDateString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns true if the stored date string no longer represents today's
 * local date — i.e., local midnight has been crossed since the record
 * was written.
 */
export function isNewLocalDay(storedDateString: string): boolean {
  return storedDateString !== getTodayDateString();
}

// ─── Live usage calculation ────────────────────────────────────────────────

/**
 * Computes current total watch time in milliseconds from a TrackingState.
 *
 * If playback is active (startedAtMs is defined) and the last heartbeat
 * is fresh enough, adds the un-flushed live delta to accumulatedMs.
 *
 * Heartbeat staleness guard:
 *   If the content script has not sent a heartbeat within HEARTBEAT_STALE_MS,
 *   it is assumed to have died (tab crash, system wake, etc.). In that case
 *   the live delta is capped at lastHeartbeatMs to prevent ghost accumulation.
 *
 * Examples:
 *   - Not playing               → accumulatedMs
 *   - Playing, fresh heartbeat  → accumulatedMs + (now - startedAtMs)
 *   - Playing, stale heartbeat  → accumulatedMs + (lastHeartbeatMs - startedAtMs)
 *   - Playing, no heartbeat yet → accumulatedMs  (just started, no heartbeat received)
 */
export function getUsedMs(state: TrackingState): number {
  if (state.startedAtMs === undefined) {
    return state.accumulatedMs;
  }

  const now = Date.now();
  const heartbeatFresh =
    state.lastHeartbeatMs !== undefined &&
    now - state.lastHeartbeatMs < CONSTANTS.HEARTBEAT_STALE_MS;

  if (!heartbeatFresh) {
    // Cap at last known-good heartbeat to avoid crediting gap time.
    if (state.lastHeartbeatMs !== undefined) {
      const cappedDelta = state.lastHeartbeatMs - state.startedAtMs;
      return state.accumulatedMs + Math.max(0, cappedDelta);
    }
    // No heartbeat received yet (playback just started) — don't add live delta.
    return state.accumulatedMs;
  }

  const liveDeltaMs = now - state.startedAtMs;
  return state.accumulatedMs + Math.max(0, liveDeltaMs);
}

// ─── Unit conversion ───────────────────────────────────────────────────────

/** Converts minutes to milliseconds. Used for limit comparisons in ms. */
export function minutesToMs(minutes: number): number {
  return minutes * 60_000;
}

/** Converts minutes to seconds. */
export function minutesToSeconds(minutes: number): number {
  return minutes * 60;
}

/** Converts seconds to whole minutes (floor). Display purposes only. */
export function secondsToMinutes(seconds: number): number {
  return Math.floor(seconds / 60);
}

// ─── Display formatting ────────────────────────────────────────────────────

/**
 * Formats a total-seconds value into a human-readable string.
 *
 * Examples:
 *   formatSeconds(0)     → '0s'
 *   formatSeconds(45)    → '45s'
 *   formatSeconds(90)    → '1m 30s'
 *   formatSeconds(3600)  → '1h'
 *   formatSeconds(3720)  → '1h 2m'
 */
export function formatSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';

  const hours   = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
