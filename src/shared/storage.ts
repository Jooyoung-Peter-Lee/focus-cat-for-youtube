// src/shared/storage.ts
// Typed wrapper around chrome.storage.local.
//
// Rules:
// - Raw storage key strings NEVER appear outside this file (use STORAGE_KEYS).
// - All reads return strongly-typed values or documented safe defaults.
// - No module interacts with chrome.storage.local directly.
//
// Write discipline (enforced by callers):
// - writeTrackingState: called on YT_PLAY, YT_PAUSE, YT_ENDED, YT_HEARTBEAT,
//   and once per alarm tick. Never per-second.
// - writeSettings: called only by the options page and the license module.

import type { TrackingState, Settings } from './types';
import { STORAGE_KEYS, DEFAULT_SETTINGS } from './types';

// ─── TrackingState ─────────────────────────────────────────────────────────

/**
 * Reads the current TrackingState from storage.
 * Returns null on first run (record not yet initialized).
 */
export async function readTrackingState(): Promise<TrackingState | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.TRACKING_STATE);
  const value: unknown = result[STORAGE_KEYS.TRACKING_STATE];
  return value !== undefined ? (value as TrackingState) : null;
}

/**
 * Writes a TrackingState record to storage.
 */
export async function writeTrackingState(state: TrackingState): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.TRACKING_STATE]: state });
}

// ─── Settings ──────────────────────────────────────────────────────────────

/**
 * Reads user settings from storage.
 * Returns DEFAULT_SETTINGS when the user has never visited the options page.
 */
export async function readSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const value: unknown = result[STORAGE_KEYS.SETTINGS];
  return value !== undefined ? (value as Settings) : { ...DEFAULT_SETTINGS };
}

/**
 * Writes user settings to storage.
 */
export async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

// ─── Batched read ──────────────────────────────────────────────────────────

/**
 * Reads both TrackingState and Settings in a single batched chrome.storage call.
 * Used by the alarm tick handler and REQUEST_LIMIT_STATE to avoid two
 * sequential async round-trips.
 */
export async function readAll(): Promise<{
  state: TrackingState | null;
  settings: Settings;
}> {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.TRACKING_STATE,
    STORAGE_KEYS.SETTINGS,
  ]);

  const stateValue: unknown = result[STORAGE_KEYS.TRACKING_STATE];
  const settingsValue: unknown = result[STORAGE_KEYS.SETTINGS];

  return {
    state: stateValue !== undefined ? (stateValue as TrackingState) : null,
    settings:
      settingsValue !== undefined
        ? (settingsValue as Settings)
        : { ...DEFAULT_SETTINGS },
  };
}
