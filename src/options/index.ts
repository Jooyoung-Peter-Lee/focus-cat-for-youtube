// src/options/index.ts
// Options page script — runs when the user opens the settings page.
//
// Responsibilities:
//   1. Read Settings + LicenseState from chrome.storage.local on page load.
//   2. Populate all form controls with stored (or default) values.
//   3. Apply Pro feature gating — lock Hard mode when not Pro; update status UI.
//   4. Validate input on Save, write settings + license state on success.
//   5. Show a brief success/error status message.
//
// No business logic lives here — readSettings/writeSettings handle storage.

import { readSettings, writeSettings } from '../shared/storage';
import type { FocusMode, Settings } from '../shared/types';
import {
  getLicenseState,
  isProActive,
  activateLicenseKey,
  deactivateLicenseKey,
  type LicenseState,
} from '../shared/license';

// ── DOM refs — resolved once on load ──────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`[FocusCat] Element #${id} not found`);
  return node as T;
}

const dailyLimitInput  = el<HTMLInputElement>('daily-limit');
const dailyLimitError  = el('daily-limit-error');
const focusModeInputs  = Array.from(
  document.querySelectorAll<HTMLInputElement>('input[name="focus-mode"]'),
);
const hardModeOption   = el<HTMLLabelElement>('hard-mode-option');
const hardModeRadio    = el<HTMLInputElement>('hard-mode-radio');
const hideHomeInput    = el<HTMLInputElement>('hide-home');
const hideRightInput   = el<HTMLInputElement>('hide-right');
const blockShortsInput = el<HTMLInputElement>('block-shorts');
const licenseKeyInput      = el<HTMLInputElement>('license-key-input');
const licenseKeyError      = el('license-key-error');
const licenseActivateBtn   = el<HTMLButtonElement>('license-activate-btn');
const licenseActivateSection = el('license-activate-section');
const licenseDeactivateSection = el('license-deactivate-section');
const licenseDeactivateBtn = el<HTMLButtonElement>('license-deactivate-btn');
const proStatusBadge       = el('pro-status-badge');
const proStatusLabel   = el('pro-status-label');
const saveBtn          = el<HTMLButtonElement>('save-btn');
const saveStatus       = el('save-status');

// ── Module-level Pro state cache ──────────────────────────────────────────
//
// Kept in sync with the checkbox so validateAndCollect() can gate Hard mode
// without re-reading storage. Updated in populate() and on checkbox change.

let currentLicenseState: LicenseState = { status: 'free' };

// ── Pro gating helpers ────────────────────────────────────────────────────

/**
 * Enables or disables Hard mode based on Pro status.
 * If Hard mode was selected but Pro is inactive, forces a fallback to Soft.
 */
function applyProGating(isPro: boolean): void {
  if (isPro) {
    hardModeRadio.disabled = false;
    hardModeOption.classList.remove('is-locked');
  } else {
    hardModeRadio.disabled = true;
    hardModeOption.classList.add('is-locked');
    // Downgrade to Soft if Hard was previously selected without Pro.
    if (hardModeRadio.checked) {
      hardModeRadio.checked = false;
      const softRadio = focusModeInputs.find((r) => r.value === 'soft');
      if (softRadio !== undefined) softRadio.checked = true;
    }
  }
}

/**
 * Updates the Pro status badge and label text to match current Pro state.
 */
function updateProStatusUI(isPro: boolean): void {
  if (isPro) {
    proStatusBadge.textContent = 'Pro Active';
    proStatusBadge.className   = 'pro-status-badge is-pro';
    proStatusLabel.textContent = 'All Pro features are unlocked.';
  } else {
    proStatusBadge.textContent = 'Free';
    proStatusBadge.className   = 'pro-status-badge is-free';
    proStatusLabel.textContent = 'Upgrade to unlock all features.';
  }
}

// ── Populate form from stored settings ────────────────────────────────────

function populate(settings: Settings, licenseState: LicenseState): void {
  currentLicenseState = licenseState;
  const isPro = isProActive(licenseState);

  dailyLimitInput.value = String(settings.dailyLimitMinutes);

  // Apply gating before setting radio values so Hard mode is disabled before
  // we attempt to check it — prevents a checked-but-disabled state flash.
  applyProGating(isPro);

  for (const radio of focusModeInputs) {
    // If Hard mode is stored but Pro is inactive, fall back to Soft.
    const effectiveMode: FocusMode =
      settings.focusMode === 'hard' && !isPro ? 'soft' : settings.focusMode;
    radio.checked = radio.value === effectiveMode;
  }

  hideHomeInput.checked    = settings.hideHomeRecommendations;
  hideRightInput.checked   = settings.hideRightRecommendations;
  blockShortsInput.checked = settings.blockShorts;

  updateProStatusUI(isPro);
  applyLicenseSectionVisibility(isPro);
}

// ── License section visibility ─────────────────────────────────────────────

function applyLicenseSectionVisibility(isPro: boolean): void {
  licenseActivateSection.style.display   = isPro ? 'none'  : 'block';
  licenseDeactivateSection.style.display = isPro ? 'flex'  : 'none';
}

// ── License key activate ───────────────────────────────────────────────────

licenseActivateBtn.addEventListener('click', () => {
  const key = licenseKeyInput.value.trim();
  if (key === '') {
    licenseKeyError.classList.add('is-visible');
    licenseKeyInput.classList.add('is-invalid');
    licenseKeyError.textContent = 'Please enter a license key.';
    return;
  }

  licenseKeyError.classList.remove('is-visible');
  licenseKeyInput.classList.remove('is-invalid');
  licenseActivateBtn.disabled = true;
  licenseActivateBtn.textContent = 'Checking…';

  activateLicenseKey(key)
    .then((result) => {
      if (result.ok) {
        currentLicenseState = { status: 'pro', licenseKey: result.licenseKey };
        applyProGating(true);
        updateProStatusUI(true);
        applyLicenseSectionVisibility(true);
        showStatus('Pro activated! Thank you.', 'ok');
        // Also persist the matching Settings field for backward compat.
        return readSettings().then((s) => writeSettings({ ...s, proEnabled: true }));
      }
      const msg =
        result.error === 'already_used'
          ? 'This key is already activated on another device.'
          : result.error === 'network_error'
          ? 'Could not reach the server. Check your connection.'
          : 'Invalid license key. Please check and try again.';
      licenseKeyError.textContent = msg;
      licenseKeyError.classList.add('is-visible');
      licenseKeyInput.classList.add('is-invalid');
    })
    .catch(() => {
      licenseKeyError.textContent = 'Unexpected error. Please try again.';
      licenseKeyError.classList.add('is-visible');
    })
    .finally(() => {
      licenseActivateBtn.disabled = false;
      licenseActivateBtn.textContent = 'Activate';
    });
});

// ── License key deactivate ─────────────────────────────────────────────────

licenseDeactivateBtn.addEventListener('click', () => {
  licenseDeactivateBtn.disabled = true;
  licenseDeactivateBtn.textContent = 'Deactivating…';

  deactivateLicenseKey()
    .then(() => {
      currentLicenseState = { status: 'free' };
      applyProGating(false);
      updateProStatusUI(false);
      applyLicenseSectionVisibility(false);
      licenseKeyInput.value = '';
      showStatus('License deactivated.', 'ok');
      return readSettings().then((s) => writeSettings({ ...s, proEnabled: false }));
    })
    .catch(() => {
      showStatus('Failed to deactivate. Please try again.', 'error');
    })
    .finally(() => {
      licenseDeactivateBtn.disabled = false;
      licenseDeactivateBtn.textContent = 'Deactivate license';
    });
});

// ── Validation + collect ──────────────────────────────────────────────────

function validateAndCollect(): Settings | null {
  let valid = true;

  // dailyLimitMinutes: integer in [0, 1440]
  const rawLimit = dailyLimitInput.value.trim();
  const limitNum = Number(rawLimit);
  const limitValid =
    rawLimit !== '' &&
    Number.isInteger(limitNum) &&
    limitNum >= 0 &&
    limitNum <= 1440;

  if (limitValid) {
    dailyLimitInput.classList.remove('is-invalid');
    dailyLimitError.classList.remove('is-visible');
  } else {
    dailyLimitInput.classList.add('is-invalid');
    dailyLimitError.classList.add('is-visible');
    valid = false;
  }

  if (!valid) return null;

  // focusMode: Hard mode requires Pro — always safe-fallback to Soft without it.
  const isPro = isProActive(currentLicenseState);
  const checkedRadio = focusModeInputs.find((r) => r.checked && !r.disabled);
  const focusMode: FocusMode =
    checkedRadio?.value === 'hard' && isPro ? 'hard' : 'soft';

  return {
    dailyLimitMinutes:        limitNum,
    focusMode,
    hideHomeRecommendations:  hideHomeInput.checked,
    hideRightRecommendations: hideRightInput.checked,
    blockShorts:              blockShortsInput.checked,
    // @deprecated stub — kept in sync for backward compat. Remove with Settings.proEnabled.
    proEnabled:               isProActive(currentLicenseState),
  };
}

// ── Status message ────────────────────────────────────────────────────────

let statusTimer: ReturnType<typeof setTimeout> | null = null;

function showStatus(message: string, kind: 'ok' | 'error'): void {
  if (statusTimer !== null) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }

  saveStatus.textContent = message;
  saveStatus.className = `save-status is-visible is-${kind}`;

  statusTimer = setTimeout(() => {
    saveStatus.classList.remove('is-visible');
    statusTimer = null;
  }, 3000);
}

// ── Save ──────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
  const settings = validateAndCollect();
  if (settings === null) return;

  saveBtn.disabled = true;

  Promise.all([writeSettings(settings)])
    .then(() => {
      showStatus('Settings saved.', 'ok');
    })
    .catch((err: unknown) => {
      console.error('[FocusCat] Failed to save settings:', err);
      showStatus('Failed to save. Please try again.', 'error');
    })
    .finally(() => {
      saveBtn.disabled = false;
    });
});

// ── Init ──────────────────────────────────────────────────────────────────

Promise.all([readSettings(), getLicenseState()])
  .then(([settings, licenseState]) => populate(settings, licenseState))
  .catch((err: unknown) => {
    console.error('[FocusCat] Failed to load settings:', err);
    showStatus('Could not load settings.', 'error');
  });
