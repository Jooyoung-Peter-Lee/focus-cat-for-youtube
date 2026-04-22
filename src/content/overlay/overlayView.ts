// src/content/overlay/overlayView.ts
// Pure DOM layer for the Focus Cat overlay.
//
// Responsibilities (only):
//   - Build overlay HTML/CSS from resolved config values
//   - Mount overlay into the #movie_player element
//   - Unmount overlay and restore any player style mutations
//   - Expose isOverlayMounted() for idempotency checks by the controller
//
// This file owns zero state beyond the player position restoration bookkeeping.
// No chrome.storage reads, no background messaging — all values arrive via
// OverlayMountOptions. The controller (overlayController.ts) drives this layer.
//
// ─── Positioning strategy ────────────────────────────────────────────────
//
// The overlay uses  position: absolute; inset: 0  to fill the #movie_player
// element exactly. This is deliberate:
//
//   1. position:fixed would cover the full viewport, but is unreliable when
//      any ancestor has a CSS transform or filter applied — a documented
//      browser behaviour that YouTube triggers in certain player states
//      (e.g., picture-in-picture transitions, ad overlays). position:absolute
//      is immune to ancestor transform contexts.
//
//   2. Covering the player area (not the viewport) is the correct UX target —
//      we block the video the user is watching, not YouTube's nav or search.
//      This keeps the tone helpful rather than punitive.
//
//   3. z-index: 999999 comfortably clears all YouTube player-internal chrome
//      (controls, captions, end cards, ad overlays which use ~300–1000 range).
//
//   4. The player must have a non-static CSS position to serve as the absolute
//      containing block. We detect and set position:relative only if the
//      computed value is 'static', and restore the original inline value on
//      unmount. YouTube's #movie_player normally already has position:absolute
//      from its own stylesheet, so this branch is rarely reached in practice.
//
// ─── Reflow discipline ───────────────────────────────────────────────────
//
// One getComputedStyle() read occurs per mount (positioning context check).
// All other operations are style writes or off-DOM tree construction.
// No geometry reads (offsetWidth, getBoundingClientRect, scrollHeight, etc.)
// appear anywhere in this file.

import { formatSeconds } from '../../shared/timeUtils';

// ─── Animated cat SVG ────────────────────────────────────────────────────────
//
// Inlined directly so no fetch, chrome.runtime.getURL, or web_accessible_resources
// entry is needed. The SVG's <defs><style> rules are scoped to #focus-cat-svg
// so they cannot leak into the host page. Keyframe names are fc-prefixed for
// the same reason. The XML declaration is omitted — it is invalid inside innerHTML.

const CAT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" id="focus-cat-svg" viewBox="0 0 512 512"
     overflow="hidden" style="display:block;width:100%;height:100%">
  <title>Focus Cat</title>
  <defs>
    <style>
      #focus-cat-svg .stroke    { fill: none; stroke: #1f1a17; stroke-width: 22; stroke-linecap: round; stroke-linejoin: round; }
      #focus-cat-svg .fill-dark { fill: #1f1a17; }
      #focus-cat-svg .fill-pink { fill: #f6a6a8; }
      #focus-cat-svg .fill-star { fill: #f4c64f; }
      #focus-cat-svg .shadow    { fill: #efe4d2; opacity: 0.65; }

      #fc-eye-left, #fc-eye-right {
        transform-box: fill-box;
        transform-origin: center;
        animation: fc-blink 4s ease-in-out infinite;
      }
      #fc-eye-right { animation-delay: 0.06s; }
      @keyframes fc-blink {
        0%, 91%, 96%, 100% { transform: scaleY(1);    }
        93.5%              { transform: scaleY(0.08); }
      }

      #fc-ear-right {
        transform-box: fill-box;
        transform-origin: center bottom;
        animation: fc-ear-twitch 5s ease-in-out infinite;
        animation-delay: 1.2s;
      }
      @keyframes fc-ear-twitch {
        0%, 84%, 96%, 100% { transform: rotate(0deg);   }
        88%                { transform: rotate(-10deg); }
        91%                { transform: rotate(5deg);   }
        94%                { transform: rotate(-2deg);  }
      }

      #fc-star {
        transform-box: fill-box;
        transform-origin: center;
        animation: fc-star-pulse 2.4s ease-in-out infinite;
      }
      @keyframes fc-star-pulse {
        0%, 100% { transform: scale(1);    opacity: 1;   }
        50%      { transform: scale(1.35); opacity: 0.8; }
      }

      #fc-head-group {
        transform-box: fill-box;
        transform-origin: center;
        animation: fc-head-tilt 10s ease-in-out infinite;
        animation-delay: 2s;
      }
      @keyframes fc-head-tilt {
        0%, 60%   { transform: rotate(0deg);  }
        65%       { transform: rotate(-2deg); }
        70%       { transform: rotate(0deg);  }
        77%       { transform: rotate(-3deg); }
        80%       { transform: rotate(5deg);  }
        87%, 100% { transform: rotate(0deg);  }
      }

      #fc-eye-right-g {
        transform-box: fill-box;
        transform-origin: center;
        animation: fc-groom-squint 10s ease-in-out infinite;
        animation-delay: 2s;
      }
      @keyframes fc-groom-squint {
        0%, 75%   { transform: scaleY(1);   }
        79%       { transform: scaleY(0.2); }
        82%       { transform: scaleY(0.2); }
        86%, 100% { transform: scaleY(1);   }
      }

      #fc-paw {
        transform-box: fill-box;
        transform-origin: center;
        animation: fc-paw-groom 10s ease-in-out infinite;
        animation-delay: 2s;
      }
      @keyframes fc-paw-groom {
        0%, 63%  { transform: translate(0px,   130px);                opacity: 0;   }
        70%      { transform: translate(0px,     0px);                opacity: 1;   }
        73%      { transform: translate(0px,    16px);                opacity: 1;   }
        76%      { transform: translate(0px,     0px);                opacity: 1;   }
        83%      { transform: translate(80px,  -50px) rotate(-20deg); opacity: 1;   }
        88%      { transform: translate(20px,   65px) rotate(-6deg);  opacity: 0.3; }
        93%      { transform: translate(0px,   130px);                opacity: 0;   }
        100%     { transform: translate(0px,   130px);                opacity: 0;   }
      }
    </style>
  </defs>

  <g id="fc-head-group">
    <ellipse class="shadow" cx="256" cy="410" rx="160" ry="44"/>
    <path class="stroke" d="M 140 214 C 110 250, 104 294, 118 335 C 136 388, 188 414, 256 414 C 324 414, 376 388, 394 335 C 408 294, 402 250, 372 214 C 350 188, 316 172, 256 172 C 196 172, 162 188, 140 214 Z"/>
    <g id="fc-ear-left">
      <path class="stroke" d="M 170 206 L 190 138 L 234 184"/>
      <path class="fill-pink" d="M 189 160 L 202 146 L 220 170 L 203 181 Z" opacity="0.9"/>
    </g>
    <g id="fc-ear-right">
      <path class="stroke" d="M 342 206 L 322 138 L 278 184"/>
      <path class="fill-pink" d="M 323 160 L 310 146 L 292 170 L 309 181 Z" opacity="0.9"/>
    </g>
    <circle id="fc-eye-left" class="fill-dark" cx="206" cy="266" r="20"/>
    <g id="fc-eye-right-g">
      <circle id="fc-eye-right" class="fill-dark" cx="306" cy="266" r="20"/>
    </g>
    <path class="stroke" d="M 240 310 C 247 320, 256 320, 263 310"/>
    <path class="stroke" d="M 263 310 C 270 320, 279 320, 286 310"/>
    <path class="fill-pink" d="M 166 298 C 182 285, 206 287, 216 304 C 205 322, 182 326, 166 313 Z" opacity="0.55"/>
    <path class="fill-pink" d="M 346 298 C 330 285, 306 287, 296 304 C 307 322, 330 326, 346 313 Z" opacity="0.55"/>
    <path class="stroke" d="M 116 276 L 156 286"/>
    <path class="stroke" d="M 114 308 L 156 306"/>
    <path class="stroke" d="M 396 276 L 356 286"/>
    <path class="stroke" d="M 398 308 L 356 306"/>
    <path id="fc-star" class="fill-star" d="M 406 164 C 416 164, 424 172, 424 182 C 424 172, 432 164, 442 164 C 432 164, 424 156, 424 146 C 424 156, 416 164, 406 164 Z"/>
    <g id="fc-paw">
      <circle cx="197" cy="358" r="15" fill="#efe4d2" stroke="#1f1a17" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="221" cy="351" r="15" fill="#efe4d2" stroke="#1f1a17" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="245" cy="358" r="15" fill="#efe4d2" stroke="#1f1a17" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <ellipse cx="221" cy="383" rx="40" ry="28" fill="#efe4d2" stroke="#1f1a17" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
      <circle  cx="204" cy="377" r="7"  fill="#d4b896"/>
      <circle  cx="221" cy="374" r="7"  fill="#d4b896"/>
      <circle  cx="238" cy="377" r="7"  fill="#d4b896"/>
      <ellipse cx="221" cy="391" rx="9" ry="7" fill="#d4b896"/>
    </g>
  </g>
</svg>
`;

// ─── Exported types ─────────────────────────────────────────────────────────

export const OVERLAY_ID = 'focus-cat-overlay';

/**
 * All values the view needs to build and fully wire the overlay.
 * The controller resolves LimitState + Settings into these primitives so the
 * view stays decoupled from domain types it does not own.
 */
export interface OverlayMountOptions {
  /** Controls which buttons are shown and which keyboard behaviour applies. */
  mode: 'soft' | 'hard';
  /** Total watch time today in ms — shown in the usage summary line. */
  usedMs: number;
  /** Configured daily limit in ms — shown in the usage summary line. */
  limitMs: number;
  /** When true, the "+ 5 more minutes" button is rendered (Soft mode only). */
  proEnabled: boolean;
  /**
   * When true, pauses the video inside `player` immediately on mount.
   * Hard mode sets this to true; Soft mode leaves the video playing.
   */
  pauseOnMount?: boolean;
  /**
   * Called after the overlay unmounts when the user clicks "Dismiss for now".
   * The controller uses this to set desiredShown = false.
   */
  onDismiss: () => void;
  /**
   * Called after the overlay unmounts when the user clicks "+ 5 more minutes".
   * The controller forwards the extension request to the background SW.
   */
  onExtend: () => void;
}

// ─── Module state ────────────────────────────────────────────────────────────
//
// These two fields track the one player element whose inline `position` style
// we changed so that unmountOverlay() can restore it precisely.
//
// Both are null when no player style mutation is outstanding.

/** The player element we set position:relative on, or null. */
let savedPlayerRef: HTMLElement | null = null;

/**
 * The inline position value that was in player.style.position before we
 * changed it (typically '' when no inline style was present).
 * null means we did NOT change the player's position style this session.
 */
let savedPlayerInlinePosition: string | null = null;

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Builds and injects the Focus Cat overlay into `player`.
 *
 * Idempotent — silently returns if OVERLAY_ID is already in the DOM.
 * Builds the entire node tree off-DOM before a single appendChild call
 * to minimise layout passes.
 */
export function mountOverlay(player: HTMLElement, options: OverlayMountOptions): void {
  // Guard: never double-mount (reattach race, rapid navigation, etc.)
  if (document.getElementById(OVERLAY_ID) !== null) return;

  // Ensure the player is an absolute positioning context.
  // getComputedStyle reflects CSS-applied values (e.g. YouTube's own
  // position:absolute on #movie_player) that player.style.position misses.
  const computedPos = getComputedStyle(player).position;
  if (computedPos === 'static') {
    savedPlayerRef            = player;
    savedPlayerInlinePosition = player.style.position; // '' or an explicit value
    player.style.position     = 'relative';
  }

  // Build the tree off-DOM, then do one append — one layout pass, no flicker.
  const overlay = buildOverlay(options);
  player.appendChild(overlay);

  // Force reflow so the browser registers opacity: 0 before we set opacity: 1,
  // then let the CSS transition animate the fade-in.
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  overlay.offsetHeight;
  overlay.style.opacity = '1';

  // Pause only when the controller explicitly requests it (Hard mode).
  // Soft mode leaves the video playing so watch time continues accumulating.
  if (options.pauseOnMount) {
    pauseVideoIn(player);
  }
}

/**
 * Removes the overlay and restores the player's position style to the exact
 * inline value it had before mountOverlay() changed it.
 *
 * Safe to call with no overlay present (pure no-op).
 * Safe to call after the player has been detached from the DOM — restoring
 * style on a detached element is harmless, and refs are cleared afterwards.
 */
export function unmountOverlay(): void {
  document.getElementById(OVERLAY_ID)?.remove();

  if (savedPlayerRef !== null && savedPlayerInlinePosition !== null) {
    savedPlayerRef.style.position = savedPlayerInlinePosition;
  }
  savedPlayerRef            = null;
  savedPlayerInlinePosition = null;
}

/**
 * Fades the overlay out, then removes it from the DOM.
 *
 * If the overlay is not present, `onComplete` is called immediately and the
 * function returns — callers need not guard for the no-overlay case.
 *
 * The `transitionend` listener fires after the 0.3s CSS transition completes.
 * A 350ms setTimeout fallback handles the edge case where `transitionend` does
 * not fire (e.g., the element was hidden or the transition was interrupted).
 * A `cleaned` flag ensures the remove + callback execute exactly once.
 *
 * Does NOT restore the player position style — that remains the responsibility
 * of `unmountOverlay()`. Callers that need position restoration (none currently)
 * should call `unmountOverlay()` after `onComplete` fires.
 */
export function fadeOutAndUnmount(onComplete?: () => void): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay === null) {
    onComplete?.();
    return;
  }

  let cleaned = false;

  function finish(): void {
    if (cleaned) return;
    cleaned = true;
    overlay.remove();
    onComplete?.();
  }

  overlay.addEventListener('transitionend', finish, { once: true });
  setTimeout(finish, 350);
  overlay.style.opacity = '0';
}

/**
 * Returns true if the overlay is present in the DOM.
 * getElementById is O(1) via the browser's internal ID table — safe to call
 * frequently from the controller without performance concern.
 */
export function isOverlayMounted(): boolean {
  return document.getElementById(OVERLAY_ID) !== null;
}

// ─── DOM construction ────────────────────────────────────────────────────────

function buildOverlay(options: OverlayMountOptions): HTMLDivElement {
  const { mode, usedMs, limitMs, proEnabled, onDismiss, onExtend } = options;
  const isHard = mode === 'hard';

  // ── Root backdrop ──────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = OVERLAY_ID;
  root.style.cssText = cssText([
    'position: absolute',
    'inset: 0',
    'z-index: 999999',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    // Frosted-glass white backdrop — visually soft, not aggressive.
    'background: rgba(255, 255, 255, 0.96)',
    'backdrop-filter: blur(8px)',
    '-webkit-backdrop-filter: blur(8px)',
    'box-sizing: border-box',
    'padding: 24px',
    // Intercept all pointer events so clicks never reach the YouTube player.
    'pointer-events: all',
    // Clip card on very small embedded players without triggering scrollbar.
    'overflow: hidden',
    // Fade-in: start transparent; mountOverlay() triggers the transition after
    // a reflow flush so the browser registers the initial opacity: 0 state.
    'opacity: 0',
    'transition: opacity 0.3s ease',
  ]);

  // Hard mode: keyboard shortcuts must not leak through to YouTube's player.
  // Capture phase (true) intercepts before any bubbling listener sees them.
  if (isHard) {
    root.addEventListener('keydown', stopEvent, true);
    root.addEventListener('keyup',   stopEvent, true);
  }

  // ── Card ──────────────────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.style.cssText = cssText([
    'background: #ffffff',
    'border-radius: 20px',
    'box-shadow: 0 20px 60px rgba(0, 0, 0, 0.13), 0 2px 8px rgba(0, 0, 0, 0.06)',
    'padding: 44px 40px 40px',
    'max-width: 400px',
    'width: 100%',
    'text-align: center',
    // System font stack — no network request, no FOUT.
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    'box-sizing: border-box',
    // Prevent the card from squishing on very short player heights.
    'flex-shrink: 0',
  ]);

  // ── Cat (animated SVG) ───────────────────────────────────────────────────
  const catEl = document.createElement('div');
  catEl.setAttribute('aria-hidden', 'true');
  catEl.style.cssText = cssText([
    'width: 160px',
    'height: 160px',
    'margin: 0 auto 16px',
    'user-select: none',
    'line-height: 0',
  ]);
  catEl.innerHTML = CAT_SVG;

  // ── Heading ───────────────────────────────────────────────────────────────
  // h2 rather than h1: the YouTube page already owns the h1 (video title).
  const heading = document.createElement('h2');
  heading.style.cssText = cssText([
    'margin: 0 0 10px',
    'font-size: 20px',
    'font-weight: 700',
    'color: #111111',
    'line-height: 1.3',
  ]);
  heading.textContent = "That's enough YouTube for today.";

  // ── Usage summary ─────────────────────────────────────────────────────────
  const summary = document.createElement('p');
  summary.style.cssText = cssText([
    'margin: 0 0 8px',
    'font-size: 14px',
    'color: #555555',
    'line-height: 1.5',
  ]);
  summary.textContent =
    `You watched ${formatSeconds(Math.round(usedMs / 1_000))} today. ` +
    `Your limit was ${formatSeconds(Math.round(limitMs / 1_000))}.`;

  // ── Encouragement ─────────────────────────────────────────────────────────
  // Hard mode copy acknowledges the user's own commitment; Soft mode is lighter.
  // Neither is punitive — both credit the user for caring about their time.
  const encourage = document.createElement('p');
  encourage.style.cssText = cssText([
    `margin: 0 0 ${isHard ? '0' : '28px'}`,
    'font-size: 13px',
    'color: #888888',
    'font-style: italic',
    'line-height: 1.5',
  ]);
  encourage.textContent = isHard
    ? 'Your cat is proud of you for setting this limit. See you tomorrow! 🌙'
    : 'Your cat believes in you. Go do something great.';

  // ── Assemble card core ────────────────────────────────────────────────────
  card.appendChild(catEl);
  card.appendChild(heading);
  card.appendChild(summary);
  card.appendChild(encourage);

  // ── Buttons — Soft mode only ──────────────────────────────────────────────
  // Hard mode intentionally has no dismiss path.
  if (!isHard) {
    const buttonRow = document.createElement('div');
    buttonRow.style.cssText = cssText([
      'display: flex',
      'gap: 10px',
      'justify-content: center',
      'flex-wrap: wrap',
    ]);

    // Dismiss: fade out, then notify controller once the animation completes.
    const dismissBtn = buildButton('Dismiss for now', '#f0f0f0', '#333333', () => {
      fadeOutAndUnmount(onDismiss);
    });
    buttonRow.appendChild(dismissBtn);

    // +5 min: Pro users get the extend button; free users see a locked upgrade prompt.
    if (proEnabled) {
      const extendBtn = buildButton('+ 5 more minutes', '#ff4444', '#ffffff', () => {
        fadeOutAndUnmount(onExtend);
      });
      buttonRow.appendChild(extendBtn);
    } else {
      buttonRow.appendChild(buildUpgradeButton());
    }

    card.appendChild(buttonRow);
  }

  root.appendChild(card);
  return root;
}

// ─── Button factory ──────────────────────────────────────────────────────────

/**
 * Locked upgrade button shown in Soft mode when the user is not on Pro.
 * Tapping it opens the options page so the user can enable Pro.
 * Styled with the Pro purple palette to signal it is a feature gate, not an error.
 */
function buildUpgradeButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type  = 'button';
  btn.title = 'Upgrade to Pro to unlock time extensions';

  // Badge span — inlined so no network fetch is needed.
  const badge = document.createElement('span');
  badge.textContent = 'Pro';
  badge.style.cssText = cssText([
    'font-size: 10px',
    'font-weight: 700',
    'letter-spacing: 0.04em',
    'text-transform: uppercase',
    'padding: 1px 5px',
    'background: #ede9fe',
    'border-radius: 4px',
    'margin-left: 4px',
    'vertical-align: middle',
  ]);

  btn.style.cssText = cssText([
    'background: #f5f3ff',
    'color: #7c3aed',
    'border: 1.5px solid #ddd6fe',
    'border-radius: 10px',
    'padding: 12px 22px',
    'font-size: 14px',
    'font-weight: 600',
    'cursor: pointer',
    'font-family: inherit',
    'line-height: 1',
    'transition: opacity 0.15s ease',
    'flex-shrink: 0',
    'display: inline-flex',
    'align-items: center',
    'gap: 0',
  ]);

  btn.appendChild(document.createTextNode('✦ +5 min '));
  btn.appendChild(badge);

  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.8'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '1';   });
  btn.addEventListener('click', () => { chrome.runtime.openOptionsPage(); });

  return btn;
}

function buildButton(
  label: string,
  bg: string,
  color: string,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type        = 'button';
  btn.textContent = label;
  btn.style.cssText = cssText([
    `background: ${bg}`,
    `color: ${color}`,
    'border: none',
    'border-radius: 10px',
    'padding: 12px 22px',
    'font-size: 14px',
    'font-weight: 600',
    'cursor: pointer',
    'font-family: inherit',
    'line-height: 1',
    'transition: opacity 0.15s ease',
    'flex-shrink: 0',
  ]);

  btn.addEventListener('mouseenter', () => { btn.style.opacity = '0.8'; });
  btn.addEventListener('mouseleave', () => { btn.style.opacity = '1';   });
  btn.addEventListener('click', onClick);

  return btn;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/** Joins an array of CSS declarations into a semicolon-separated cssText string. */
function cssText(declarations: string[]): string {
  return declarations.join('; ');
}

/**
 * Hard-mode keyboard trap.
 * Both stopPropagation and stopImmediatePropagation are called:
 * - stopPropagation prevents the event from bubbling to YouTube's handlers.
 * - stopImmediatePropagation prevents other listeners on the same element
 *   from firing, in case YouTube has added capture-phase listeners of its own.
 */
function stopEvent(e: Event): void {
  e.stopPropagation();
  e.stopImmediatePropagation();
}

/**
 * Pauses the <video> element scoped to `player`.
 * Searches within player bounds only — no full-document query.
 * Calling .pause() on an already-paused video is a safe no-op per the spec.
 */
function pauseVideoIn(player: HTMLElement): void {
  const video = player.querySelector<HTMLVideoElement>('video');
  if (video !== null && !video.paused) {
    video.pause();
  }
}
