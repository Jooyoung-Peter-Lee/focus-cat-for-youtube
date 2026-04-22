// src/content/domCleaner.ts
// DOM distraction removal for YouTube.
//
// ─── Implementation approach ──────────────────────────────────────────────
//
// Two-layer strategy:
//
// Layer 1 — CSS injection (immediate):
//   A single managed <style> element is injected into <head> on content
//   script load. All target selectors use display:none !important so
//   matching elements are hidden before the user's first paint, and
//   automatically stay hidden for elements added dynamically later —
//   no observer required for this layer.
//   Fully reversible: removing the <style> instantly restores YouTube's
//   original appearance with no leftover mutation side-effects.
//
// Layer 2 — DOM removal (selective, via MutationObserver):
//   A MutationObserver on document.body (subtree: true) detects newly
//   added nodes and physically removes only relatively self-contained,
//   lower-risk distraction surfaces (e.g. home recommendation grids and
//   Shorts shelves/pages).
//
//   Important safety rule:
//   Watch-page right sidebar recommendations are CSS-hidden only.
//   We intentionally do NOT remove watch layout containers or secondary
//   column nodes, because YouTube's Kevlar/Polymer two-column logic may
//   still expect those containers to exist and can throw runtime errors
//   if they are detached.
//
//   The observer callback is gated behind requestAnimationFrame and then
//   debounced at 16 ms so DOM removal never runs mid-Polymer-render and
//   stays off the hot path during YouTube's high-frequency renders.
//   On every SPA route change, applyCleaning() is re-called from index.ts,
//   which disconnects the old observer and starts a fresh one.
//   Every removal is wrapped in its own try/catch so a stale selector or
//   detached parent never disrupts the rest of the removal pass.
//
// ─── Selector resilience ──────────────────────────────────────────────────
//
// Attribute-based and tag-based selectors (e.g., ytd-browse[page-subtype])
// are preferred over class-name chains. Custom element tag names and data
// attributes are far more stable across YouTube UI updates than the
// frequently-scrambled class strings.
//
// All CSS rules use !important to win over YouTube's own inline style updates.

import type { Settings } from '../shared/types';

const STYLE_ELEMENT_ID = 'focus-cat-cleaner';
const DEBOUNCE_MS = 16;

// ─── CSS rule sets ─────────────────────────────────────────────────────────
//
// Each rule set is self-contained and toggled independently based on Settings.
// Kept as constants (not computed strings) so they appear verbatim in
// DevTools and are easy to inspect.

/** Hides the recommendation grid on the YouTube home page. */
const HOME_RECOMMENDATIONS_CSS = `
  /* Focus Cat: hide home page recommendation grid */
  ytd-browse[page-subtype="home"] ytd-rich-grid-renderer,
  ytd-browse[page-subtype="home"] ytd-rich-grid-media {
    display: none !important;
  }
`;

/**
 * Hides watch-page recommendation content while preserving the secondary
 * layout containers that YouTube's two-column logic expects to remain in DOM.
 *
 * Do NOT target #secondary itself here.
 */
const RIGHT_SIDEBAR_CSS = `
  /* Focus Cat: hide watch page recommendation contents, but keep layout containers intact */
  ytd-watch-flexy #related,
  ytd-watch-flexy ytd-watch-next-secondary-results-renderer,
  ytd-watch-grid #related,
  ytd-watch-grid ytd-watch-next-secondary-results-renderer {
    display: none !important;
  }

  /* Expand the primary column when recommendation contents are hidden */
  ytd-watch-flexy:not([theater]):not([fullscreen]) #primary {
    max-width: 100% !important;
  }
`;

/**
 * Hides all Shorts-related UI surfaces:
 * - Shorts shelves on home and search results
 * - Shorts entry in the left navigation guide
 * - Shorts chip in the search/home filter bar
 * - The /shorts/ browse page content
 *
 * Uses :has() (Chrome 105+, baseline in our Chrome target) to target
 * guide entries by their anchor text without relying on fragile class names.
 */
const SHORTS_CSS = `
  /* Focus Cat: hide Shorts shelves */
  ytd-reel-shelf-renderer,
  ytd-rich-shelf-renderer[is-shorts] {
    display: none !important;
  }

  /* Focus Cat: hide Shorts entry in navigation guide */
  ytd-guide-entry-renderer:has(a[title="Shorts"]),
  ytd-mini-guide-entry-renderer:has(a[title="Shorts"]) {
    display: none !important;
  }

  /* Focus Cat: hide Shorts filter chip in search/home */
  yt-chip-cloud-chip-renderer[aria-label="Shorts"] {
    display: none !important;
  }

  /* Focus Cat: hide Shorts browse page feed */
  ytd-browse[page-subtype="shorts"] ytd-page-manager,
  ytd-browse[page-subtype="shorts"] #contents {
    display: none !important;
  }
`;

// ─── DOM removal selector groups ───────────────────────────────────────────
//
// Mirrors the CSS rule sets above but only for surfaces considered safe to
// remove entirely. Watch-page right recommendations are intentionally excluded
// and remain CSS-only to avoid breaking YouTube's layout internals.

interface RemovalGroup {
  /** The Settings flag that activates this group. */
  readonly setting: 'hideHomeRecommendations' | 'hideRightRecommendations' | 'blockShorts';
  /** querySelectorAll-compatible selectors for elements to remove. */
  readonly selectors: readonly string[];
}

const REMOVAL_GROUPS: readonly RemovalGroup[] = [
  {
    setting: 'hideHomeRecommendations',
    selectors: [
      'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer',
      'ytd-browse[page-subtype="home"] ytd-rich-grid-media',
    ],
  },

  // Intentionally omitted:
  // hideRightRecommendations
  //
  // Watch-page right recommendations are hidden via CSS only.
  // Removing #secondary / related watch-column nodes can break YouTube's
  // Kevlar two-column layout updates and cause runtime errors.

  {
    setting: 'blockShorts',
    selectors: [
      'ytd-reel-shelf-renderer',
      'ytd-rich-shelf-renderer[is-shorts]',
      'ytd-browse[page-subtype="shorts"] ytd-page-manager',
      'ytd-browse[page-subtype="shorts"] #contents',
    ],
  },
] as const;

// ─── MutationObserver state ────────────────────────────────────────────────

let domObserver: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let rafHandle: number | null = null;
/** The Settings snapshot in use by the currently running observer. */
let observerSettings: Settings | null = null;

// ─── DOM removal helpers ───────────────────────────────────────────────────

/**
 * Scans the live DOM for all elements matching the active REMOVAL_GROUPS and
 * removes each one via parentNode.removeChild().
 *
 * Each removal is individually try/catched so a stale selector, a node that
 * was already removed by a concurrent mutation, or an unexpected DOM structure
 * never aborts the rest of the pass.
 */
function removeTargetedElements(settings: Settings): void {
  for (const group of REMOVAL_GROUPS) {
    if (!settings[group.setting]) continue;

    for (const selector of group.selectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          try {
            el.parentNode?.removeChild(el);
          } catch {
            // Node already detached or re-parented — safe to ignore.
          }
        });
      } catch {
        // Selector threw (e.g., malformed after a future YouTube DOM change).
        // Swallow silently so other selectors still run.
      }
    }
  }
}

/**
 * Schedules a DOM removal pass, debounced to DEBOUNCE_MS.
 * Called on every MutationObserver batch. Multiple rapid callbacks are
 * collapsed into a single pass fired after the burst settles.
 *
 * The setTimeout is gated behind a requestAnimationFrame so the removal
 * never runs mid-Polymer-render. Without this gate, mutating the DOM
 * during YouTube's render cycle can trigger isTwoColumnsChanged_ to call
 * insertBefore on an already-invalidated node (queryHandler → _setQueryMatches
 * → isTwoColumnsChanged_ → insertBefore).
 */
function scheduleDomRemoval(): void {
  if (rafHandle !== null) cancelAnimationFrame(rafHandle);
  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (observerSettings !== null) {
        removeTargetedElements(observerSettings);
      }
    }, DEBOUNCE_MS);
  });
}

/**
 * Disconnects any running observer, then starts a fresh one for the given
 * settings snapshot. Runs an immediate removal pass before observing so
 * elements already present in the DOM are cleaned without waiting for a
 * mutation.
 *
 * Silently no-ops if document.body is not yet available (extremely early
 * script injection edge case).
 */
function startDomObserver(settings: Settings): void {
  stopDomObserver();

  if (document.body === null) return;

  observerSettings = settings;

  // Immediate sweep — catches elements already in the DOM on (re-)init
  // before the MutationObserver has a chance to fire.
  removeTargetedElements(settings);

  domObserver = new MutationObserver(scheduleDomRemoval);
  domObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Cancels the pending debounce timer and disconnects the MutationObserver.
 * Safe to call when no observer is running.
 */
function stopDomObserver(): void {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  domObserver?.disconnect();
  domObserver = null;
  observerSettings = null;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Applies or updates DOM cleaning based on the provided settings.
 *
 * Layer 1: creates/updates the managed <style> element with the CSS rules
 * that correspond to the current settings. Single O(1) DOM write.
 *
 * Layer 2: (re-)starts the MutationObserver-based DOM remover. Any existing
 * observer is disconnected first, so calling this on every SPA route change
 * automatically handles the reconnect requirement.
 *
 * Safe to call multiple times; idempotent when settings have not changed.
 */
export function applyCleaning(settings: Settings): void {
  // Layer 1: instant CSS hide.
  const style = getOrCreateStyleElement();
  style.textContent = buildCssRules(settings);

  // Layer 2: DOM removal via MutationObserver.
  startDomObserver(settings);
}

/**
 * Removes all cleaning CSS and stops the MutationObserver.
 * Instantly restores YouTube's original appearance.
 * Called when the extension is disabled or all settings are turned off.
 */
export function removeCleaning(): void {
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
  stopDomObserver();
}

// ─── CSS helpers ───────────────────────────────────────────────────────────

function buildCssRules(settings: Settings): string {
  const rules: string[] = [];

  if (settings.hideHomeRecommendations) {
    rules.push(HOME_RECOMMENDATIONS_CSS);
  }
  if (settings.hideRightRecommendations) {
    rules.push(RIGHT_SIDEBAR_CSS);
  }
  if (settings.blockShorts) {
    rules.push(SHORTS_CSS);
  }

  return rules.join('\n');
}

function getOrCreateStyleElement(): HTMLStyleElement {
  const existing = document.getElementById(STYLE_ELEMENT_ID);
  if (existing instanceof HTMLStyleElement) return existing;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;

  // Append to <head> if available (preferred: applied before first paint on
  // hard reloads), fall back to <html> root if head is not yet parsed.
  (document.head ?? document.documentElement).appendChild(style);

  return style;
}