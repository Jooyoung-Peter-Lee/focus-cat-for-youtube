// src/popup/index.ts
// Popup script — runs when the user clicks the Focus Cat toolbar icon.
//
// Data flow (two complementary update paths):
//   chrome.storage.onChanged → tick()   primary: fires immediately on every write
//   setInterval (1 s)        → tick()   fallback: catches date rollovers and
//                                        ensures the display never freezes
//
// storage.onChanged fires the instant the background writes new data (alarm
// tick or session-end flush), so the display reacts within milliseconds.
// setInterval handles the case where storage has not changed but the date
// display needs to roll over at midnight.

import { readAll } from '../shared/storage';
import { CONSTANTS } from '../shared/types';
import { getTodayDateString, getUsedMs } from '../shared/timeUtils';
import type { Settings } from '../shared/types';

// ── Clock formatting ──────────────────────────────────────────────────────

/**
 * Formats a seconds value as MM:SS (under one hour) or H:MM:SS (one hour+).
 *   formatClock(0)     → "00:00"
 *   formatClock(90)    → "01:30"
 *   formatClock(3600)  → "1:00:00"
 *   formatClock(3661)  → "1:01:01"
 */
function formatClock(totalSeconds: number): string {
  const s   = Math.max(0, Math.floor(totalSeconds));
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm  = String(m).padStart(2, '0');
  const ss  = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Returns today's date as a short localised string, e.g. "Mon, Feb 24". */
function formatToday(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  });
}

// ── Display state ─────────────────────────────────────────────────────────

type DisplayState = 'nolimit' | 'under' | 'warning' | 'exceeded';

function deriveState(usedSeconds: number, limitSeconds: number): DisplayState {
  if (limitSeconds <= 0) return 'nolimit';
  if (usedSeconds >= limitSeconds) return 'exceeded';
  if (usedSeconds >= limitSeconds * CONSTANTS.WARNING_THRESHOLD_FRACTION) return 'warning';
  return 'under';
}

// ── DOM refs ──────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`[FocusCat] Element #${id} not found`);
  return node as T;
}

const viewLoading  = el('view-loading');
const viewContent  = el('view-content');
const todayDateEl  = el('today-date');
const usedTimeEl   = el('used-time');
const limitLabelEl = el('limit-label');
const barWrapEl    = el('bar-wrap');
const barFillEl    = el('bar-fill');
const barPctEl     = el('bar-pct');
const statusMsgEl  = el('status-msg');
const settingsBtn  = el<HTMLButtonElement>('settings-btn');

// ── Render ────────────────────────────────────────────────────────────────

function render(usedSeconds: number, settings: Settings, extensionSeconds = 0): void {
  const limitSeconds = settings.dailyLimitMinutes * 60 + extensionSeconds;
  const state        = deriveState(usedSeconds, limitSeconds);

  // Date line
  todayDateEl.textContent = formatToday();

  // Clock
  usedTimeEl.textContent = formatClock(usedSeconds);

  // Label beside the clock
  limitLabelEl.textContent = state === 'nolimit'
    ? 'watched today'
    : `of ${formatClock(limitSeconds)} limit`;

  // Progress bar
  if (state === 'nolimit') {
    barWrapEl.classList.add('hidden');
  } else {
    barWrapEl.classList.remove('hidden');
    const pct = Math.min(100, Math.round((usedSeconds / limitSeconds) * 100));
    barFillEl.style.width = `${pct}%`;
    barPctEl.textContent  = `${pct}%`;
  }

  // Status / remaining
  statusMsgEl.className = 'status-msg';

  switch (state) {
    case 'nolimit':
      statusMsgEl.textContent = 'No daily limit set. Go to Settings to add one.';
      break;

    case 'under': {
      const rem = limitSeconds - usedSeconds;
      statusMsgEl.textContent = `${formatClock(rem)} remaining today`;
      break;
    }

    case 'warning': {
      const rem = limitSeconds - usedSeconds;
      statusMsgEl.textContent = `Running low — ${formatClock(rem)} left`;
      statusMsgEl.classList.add('is-warning');
      break;
    }

    case 'exceeded':
      statusMsgEl.textContent = "Limit reached. Take a break — you've earned it!";
      statusMsgEl.classList.add('is-exceeded');
      break;
  }

  // State attribute drives CSS accent colour
  document.documentElement.setAttribute('data-state', state);

  // First render: swap loading → content
  viewLoading.classList.add('hidden');
  viewContent.classList.remove('hidden');
}

// ── Settings button ───────────────────────────────────────────────────────

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// ── Tick — read storage and re-render every second ────────────────────────

function tick(): void {
  const today = getTodayDateString();
  readAll()
    .then(({ state, settings }) => {
      let usedSeconds     = 0;
      let extensionSeconds = 0;
      if (state !== null && state.date === today) {
        // getUsedMs returns ms including any live un-flushed delta.
        usedSeconds      = Math.round(getUsedMs(state) / 1000);
        extensionSeconds = Math.round((state.extensionMs ?? 0) / 1000);
      }
      render(usedSeconds, settings, extensionSeconds);
    })
    .catch(console.error);
}

// Primary: react immediately whenever the background writes new data.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return;
  tick();
});

// Fallback: re-render every second to catch date rollovers and ensure the
// display never appears frozen if an onChanged event is somehow missed.
tick();
setInterval(tick, 1_000);
