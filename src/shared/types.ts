// src/shared/types.ts
// Single source of truth for all domain types, constants, and message
// contracts used across background, content, popup, and options layers.
// Every other module imports from here — never define domain types inline.

// ─── Domain types ──────────────────────────────────────────────────────────

export type FocusMode = 'soft' | 'hard';

export type LicenseStatus = 'free' | 'pro' | 'expired';

/**
 * Persisted license state in chrome.storage.local under STORAGE_KEYS.LICENSE_STATE.
 * All Pro gate decisions must go through isProActive() in license.ts — never
 * read this object's fields directly in feature code.
 */
export interface LicenseState {
  status: LicenseStatus;
  /** Opaque key issued after purchase. Undefined on free tier. */
  licenseKey?: string;
  /** Expiry as epoch ms. Undefined means lifetime (no expiry). */
  expiresAt?: number;
}

/**
 * Persisted tracking state in chrome.storage.local.
 *
 * Replaces the old DailyUsage + in-memory TrackerState model.
 * Persisting startedAtMs means the live usage formula
 *   used = accumulatedMs + (now - startedAtMs)
 * works correctly even after service worker suspension and revival.
 */
export interface TrackingState {
  /** Local date string in 'YYYY-MM-DD' format — used for daily reset detection. */
  date: string;
  /** Confirmed watch time in milliseconds. Only grows on pause/ended. */
  accumulatedMs: number;
  /** Date.now() when current playback started. Undefined when not playing. */
  startedAtMs?: number;
  /** Date.now() of the last YT_HEARTBEAT from the content script. */
  lastHeartbeatMs?: number;
  /** Tab ID that is currently playing. Used for future pause-on-limit. */
  playingTabId?: number;
  /** Total milliseconds added via "+N min" extensions today. Reset with daily reset. */
  extensionMs?: number;
}

export interface Settings {
  /** Daily YouTube watch limit in minutes. 0 means no limit enforced. */
  dailyLimitMinutes: number;
  focusMode: FocusMode;
  hideHomeRecommendations: boolean;
  hideRightRecommendations: boolean;
  blockShorts: boolean;
  /**
   * @deprecated Migration stub — kept for backward compatibility during Phase 3 rollout.
   * Do NOT read this field anywhere in feature code.
   * Use isProActive(await getLicenseState()) from shared/license.ts instead.
   * Will be removed once all call sites are confirmed migrated.
   */
  proEnabled: boolean;
}

/**
 * Represents the current state of usage relative to the daily limit.
 *
 * Discriminated union so TypeScript enforces exhaustive handling in consumers.
 * usedMs / limitMs are in milliseconds — avoids conversion errors at the
 * computation layer; display layers convert to seconds/minutes as needed.
 */
export type LimitState =
  | { kind: 'under' }
  | { kind: 'warning';  usedMs: number; limitMs: number }
  | { kind: 'exceeded'; usedMs: number; limitMs: number };

// ─── Message contracts ─────────────────────────────────────────────────────

/** Messages sent from the background service worker to content scripts. */
export type BackgroundToContentMessage =
  | { type: 'LIMIT_STATE_UPDATE'; payload: LimitState }
  | { type: 'SETTINGS_UPDATE'; payload: Settings };

/**
 * Messages sent from content scripts to the background service worker.
 *
 * YT_PLAY      — video.play event fired; background sets startedAtMs.
 * YT_PAUSE     — video.pause event fired; background flushes delta to accumulatedMs.
 * YT_ENDED     — video.ended event fired; same as YT_PAUSE.
 * YT_HEARTBEAT — periodic signal while playing; background updates lastHeartbeatMs.
 * REQUEST_LIMIT_STATE — content script init; background replies with LIMIT_STATE_UPDATE.
 * ADD_EXTENSION_MINUTES — Pro "+N min" button (Phase 3, silently ignored for MVP).
 */
export type ContentToBackgroundMessage =
  | { type: 'YT_PLAY' }
  | { type: 'YT_PAUSE' }
  | { type: 'YT_ENDED' }
  | { type: 'YT_HEARTBEAT'; isPlaying: boolean; currentTimeSec: number }
  | { type: 'REQUEST_LIMIT_STATE' }
  | { type: 'ADD_EXTENSION_MINUTES'; minutes: number };

// ─── Storage keys ──────────────────────────────────────────────────────────

/**
 * All chrome.storage.local keys in one place.
 * Raw key strings must never appear outside storage.ts.
 */
export const STORAGE_KEYS = {
  TRACKING_STATE:  'focusCat_trackingState',
  SETTINGS:        'focusCat_settings',
  LICENSE_STATE:   'focusCat_licenseState',
} as const;

// ─── Application constants ─────────────────────────────────────────────────

export const CONSTANTS = {
  /** chrome.alarms identifier — must be consistent across create/get/listen. */
  ALARM_NAME: 'focusCat_tick' as const,

  /** Alarm period in minutes. Chrome's minimum for MV3 persistent alarms. */
  ALARM_PERIOD_MINUTES: 1,

  /**
   * How often the content script sends YT_HEARTBEAT while playing (ms).
   * Background expects at least one heartbeat per HEARTBEAT_STALE_MS window.
   */
  HEARTBEAT_INTERVAL_MS: 10_000,

  /**
   * Maximum acceptable age of the last heartbeat before the background
   * treats playback as stale (content script died / system woke from sleep).
   * Chosen as HEARTBEAT_INTERVAL_MS × 2 + 5 s jitter buffer.
   */
  HEARTBEAT_STALE_MS: 25_000,

  /**
   * Maximum delta accepted during an alarm flush even when heartbeat is fresh.
   * Guards against edge cases where heartbeat timestamps and startedAtMs
   * span a system sleep boundary. 2× alarm period + 30 s jitter.
   */
  MAX_TICK_GAP_MS: 150_000,

  /**
   * Fraction of dailyLimitMinutes at which 'warning' state activates.
   * 0.9 → warning fires at 90% of the limit.
   */
  WARNING_THRESHOLD_FRACTION: 0.9,

  /** Fallback limit when the user has never opened the options page. */
  DEFAULT_DAILY_LIMIT_MINUTES: 60,

  /**
   * Strict YouTube hostname.
   * Excludes music.youtube.com, studio.youtube.com, etc.
   */
  YOUTUBE_HOSTNAME: 'www.youtube.com' as const,
} as const;

// ─── Default settings ──────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  dailyLimitMinutes: CONSTANTS.DEFAULT_DAILY_LIMIT_MINUTES,
  focusMode: 'soft',
  hideHomeRecommendations: true,
  hideRightRecommendations: false,
  blockShorts: false,
  proEnabled: false,
} as const;
