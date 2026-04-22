// src/background/limitEnforcer.ts
// Limit state computation and content script notification.
//
//   computeLimitState   — pure function, no I/O.
//   broadcastLimitState — Chrome API I/O, no computation.

import type {
  LimitState,
  Settings,
  TrackingState,
  BackgroundToContentMessage,
} from '../shared/types';
import { CONSTANTS } from '../shared/types';
import { getUsedMs, minutesToMs } from '../shared/timeUtils';

// ─── Computation ───────────────────────────────────────────────────────────

/**
 * Derives the current LimitState from tracking state and user settings.
 *
 * Pure function — no side effects, no Chrome API calls.
 *
 * Decision logic:
 *   - dailyLimitMinutes <= 0   → no limit configured → 'under'.
 *   - usedMs >= limitMs        → 'exceeded'.
 *   - usedMs >= limitMs × 0.9  → 'warning'.
 *   - otherwise                → 'under'.
 *
 * usedMs is computed live via getUsedMs(state), which adds any un-flushed
 * playback delta on top of accumulatedMs — so the state pushed to content
 * scripts is always current, not just the last alarm-tick snapshot.
 */
export function computeLimitState(
  state: TrackingState,
  settings: Settings,
): LimitState {
  if (settings.dailyLimitMinutes <= 0) {
    return { kind: 'under' };
  }

  const limitMs    = minutesToMs(settings.dailyLimitMinutes) + (state.extensionMs ?? 0);
  const usedMs     = getUsedMs(state);

  if (usedMs >= limitMs) {
    return { kind: 'exceeded', usedMs, limitMs };
  }

  if (usedMs >= limitMs * CONSTANTS.WARNING_THRESHOLD_FRACTION) {
    return { kind: 'warning', usedMs, limitMs };
  }

  return { kind: 'under' };
}

// ─── Broadcast ─────────────────────────────────────────────────────────────

/**
 * Sends a LIMIT_STATE_UPDATE message to all currently open YouTube tabs.
 *
 * Per-tab errors are swallowed: the tab may still be loading, or may have
 * been closed between the query and the sendMessage call.
 *
 * Uses Promise.allSettled so a failed send to one tab does not prevent
 * delivery to the remaining tabs.
 */
export async function broadcastLimitState(limitState: LimitState): Promise<void> {
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' });

  const message: BackgroundToContentMessage = {
    type: 'LIMIT_STATE_UPDATE',
    payload: limitState,
  };

  const sends = tabs
    .filter(
      (tab): tab is chrome.tabs.Tab & { id: number } => tab.id !== undefined,
    )
    .map((tab) =>
      chrome.tabs.sendMessage(tab.id, message).catch(() => {
        // Content script not yet ready or tab was closed — silently ignore.
      }),
    );

  await Promise.allSettled(sends);
}
