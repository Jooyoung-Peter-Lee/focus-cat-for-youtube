// src/background/dateReset.ts
// Automatic daily usage reset.
//
// Detects when the stored TrackingState belongs to a previous local calendar
// day and resets accumulatedMs to 0 for the new day.
//
// Called at three points:
//   1. chrome.runtime.onInstalled  — first install and extension updates.
//   2. chrome.runtime.onStartup    — browser launch after overnight closure.
//   3. Every alarm tick            — handles "browser left open across midnight".
//
// Reset is event-triggered — no background cron required.

import { readTrackingState, writeTrackingState } from '../shared/storage';
import { getTodayDateString, isNewLocalDay } from '../shared/timeUtils';
import type { TrackingState } from '../shared/types';

/**
 * Checks whether the stored TrackingState belongs to a previous local day.
 *
 * - If no record exists (first run): initializes storage with today's date
 *   and accumulatedMs = 0.
 * - If the stored date is stale (past midnight): overwrites with a fresh
 *   zero record for today (also clears any startedAtMs).
 * - If the stored date is today: no-op.
 *
 * Returns true if a reset or initialization occurred.
 */
export async function checkAndResetIfNewDay(): Promise<boolean> {
  const state = await readTrackingState();

  if (state === null) {
    await writeTrackingState(buildFreshState());
    return true;
  }

  if (isNewLocalDay(state.date)) {
    await writeTrackingState(buildFreshState());
    return true;
  }

  return false;
}

// ─── Private helpers ───────────────────────────────────────────────────────

function buildFreshState(): TrackingState {
  return {
    date: getTodayDateString(),
    accumulatedMs: 0,
  };
}
