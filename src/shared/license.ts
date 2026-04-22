// src/shared/license.ts
// Single source of truth for Pro feature gating.
//
// ALL Pro checks in the extension must go through isProActive() — never
// inspect LicenseState.status directly in feature code.
//
// This abstraction layer means the Phase 3 migration from a local stub to
// server-side Stripe license validation is a one-file change: replace the
// body of getLicenseState() without touching any call site.
//
// isProActive() is intentionally synchronous — callers resolve LicenseState
// once (on init or on storage change) and then call isProActive() with the
// cached value. This avoids async reads at every gate check.

import type { LicenseState, LicenseStatus } from './types';
import { STORAGE_KEYS } from './types';
import { readSettings, writeSettings } from './storage';

// Re-export so callers only need to import from license.ts.
export type { LicenseStatus, LicenseState };

// ─── Pro feature catalogue ──────────────────────────────────────────────────

/**
 * Exhaustive list of features unlocked by a Pro license.
 * Add new Pro features here first — never gate behind ad-hoc "if pro" checks
 * scattered across the codebase.
 */
export const PRO_FEATURES = {
  /** Hard mode: overlay cannot be dismissed — enforces the limit absolutely. */
  HARD_MODE: 'hard_mode',

  /** Soft mode dismiss: user can extend their limit by +5 minutes once. */
  SOFT_MODE_EXTEND: 'soft_mode_extend',

  /** (future) Sync daily limits and usage across devices via the cloud. */
  MULTI_DEVICE_SYNC: 'multi_device_sync',

  /** (future) Full per-day usage history and trend charts. */
  USAGE_HISTORY: 'usage_history',
} as const;

export type ProFeature = (typeof PRO_FEATURES)[keyof typeof PRO_FEATURES];

// ─── Storage ─────────────────────────────────────────────────────────────────

const DEFAULT_LICENSE_STATE: LicenseState = { status: 'free' };

/**
 * Reads the current LicenseState from chrome.storage.local.
 * Returns { status: 'free' } if nothing has been stored yet.
 */
export async function getLicenseState(): Promise<LicenseState> {
  return new Promise((resolve) => {
    chrome.storage.local.get(STORAGE_KEYS.LICENSE_STATE, (result) => {
      const stored = result[STORAGE_KEYS.LICENSE_STATE] as LicenseState | undefined;
      resolve(stored ?? DEFAULT_LICENSE_STATE);
    });
  });
}

/**
 * Persists a LicenseState to chrome.storage.local.
 * Called after a purchase is confirmed, a subscription expires, or a license
 * is revoked. The storage change fires chrome.storage.onChanged, which lets
 * all listeners (e.g., overlayController) react without polling.
 */
export async function setLicenseState(state: LicenseState): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEYS.LICENSE_STATE]: state }, () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else {
        resolve();
      }
    });
  });
}

// ─── Gate check ──────────────────────────────────────────────────────────────

/**
 * Returns true if the Pro feature set is currently active.
 *
 * Rules:
 *   - status must be 'pro'
 *   - if expiresAt is set, it must be in the future
 *
 * Synchronous by design — callers resolve LicenseState once (on init or on
 * storage change) and pass the cached value here at every gate check.
 */
export function isProActive(state: LicenseState): boolean {
  if (state.status !== 'pro') return false;
  if (state.expiresAt !== undefined && state.expiresAt <= Date.now()) return false;
  return true;
}

// ─── Backend license verification ───────────────────────────────────────────
//
// The extension never calls Lemon Squeezy directly — all API secrets live in
// the Vercel backend. The extension only knows the public verification endpoint.

const VERIFY_ENDPOINT = 'https://focus-cat-api.vercel.app/api/verify-license';

export type ActivateResult =
  | { ok: true;  licenseKey: string }
  | { ok: false; error: 'invalid_key' | 'already_used' | 'network_error' };

/**
 * Sends the license key to the backend for activation with Lemon Squeezy.
 *
 * On success: persists { status: 'pro', licenseKey } to storage.
 * On failure: returns an error code — caller shows the appropriate message.
 */
export async function activateLicenseKey(key: string): Promise<ActivateResult> {
  let res: Response;
  try {
    res = await fetch(VERIFY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ licenseKey: key }),
    });
  } catch {
    return { ok: false, error: 'network_error' };
  }

  if (res.status === 400) return { ok: false, error: 'invalid_key' };
  if (res.status === 409) return { ok: false, error: 'already_used' };
  if (!res.ok)            return { ok: false, error: 'network_error' };

  await setLicenseState({ status: 'pro', licenseKey: key.trim().toUpperCase() });
  return { ok: true, licenseKey: key.trim().toUpperCase() };
}

const DEACTIVATE_ENDPOINT = 'https://focus-cat-api.vercel.app/api/deactivate-license';

/**
 * Deactivates the stored license key via the backend, then clears Pro status locally.
 *
 * Deactivation frees up a Lemon Squeezy activation slot so the user can
 * re-activate on another device. Always clears local Pro status even if the
 * network call fails (local-first).
 */
export async function deactivateLicenseKey(): Promise<void> {
  const current = await getLicenseState();
  if (current.licenseKey !== undefined) {
    try {
      await fetch(DEACTIVATE_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ licenseKey: current.licenseKey }),
      });
    } catch {
      // Network failure — proceed with local deactivation anyway.
    }
  }
  await setLicenseState({ status: 'free' });
}

// ─── Deprecated helpers ───────────────────────────────────────────────────────
//
// These wrappers exist for the migration period while Settings.proEnabled
// is still present as a deprecated stub. Remove this section once
// Settings.proEnabled is deleted in a follow-up PR.

/**
 * @deprecated Use getLicenseState() + isProActive() instead.
 */
export async function isProEnabled(): Promise<boolean> {
  return isProActive(await getLicenseState());
}

/**
 * @deprecated Use setLicenseState({ status: 'pro' }) instead.
 */
export async function activatePro(): Promise<void> {
  const current = await getLicenseState();
  if (current.status === 'pro') return; // already active — no unnecessary write
  await setLicenseState({ ...current, status: 'pro' });
  // Sync the deprecated Settings field for backward compat.
  const settings = await readSettings();
  if (!settings.proEnabled) await writeSettings({ ...settings, proEnabled: true });
}

/**
 * @deprecated Use setLicenseState({ status: 'free' }) instead.
 */
export async function deactivatePro(): Promise<void> {
  const current = await getLicenseState();
  if (current.status !== 'pro') return; // already inactive — no unnecessary write
  await setLicenseState({ ...current, status: 'free' });
  // Sync the deprecated Settings field for backward compat.
  const settings = await readSettings();
  if (settings.proEnabled) await writeSettings({ ...settings, proEnabled: false });
}
