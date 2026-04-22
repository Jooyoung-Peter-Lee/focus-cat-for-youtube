// src/content/overlay/warningBanner.ts
// Non-intrusive warning banner shown visually above the YouTube player when the
// user reaches ≥90% of their daily YouTube limit.
//
// This version intentionally mounts into document.body instead of appending
// inside #movie_player. The goal is to avoid interfering with YouTube's
// internally managed player subtree (Kevlar / Polymer DOM).
//
// The banner is positioned using the player's viewport rect and follows the
// player on scroll / resize while visible.
//
// Design constraints:
//   - Mounted in document.body (portal-style)
//   - position: fixed so it tracks the viewport rect of the player
//   - z-index: 999998 — just below the full overlay (999999)
//   - Inline styles only — no external CSS, no injected <style> tags
//   - Minimal DOM
//   - Idempotent: safe to call showWarningBanner() repeatedly
//   - Avoids touching YouTube's player child tree

export const BANNER_ID = 'focus-cat-warning-banner';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BannerOptions {
  /** Remaining seconds until the daily limit is reached. Used in message copy. */
  remainingSeconds: number;
  /**
   * Optional callback fired after the banner finishes its dismiss animation.
   * Not required by the controller — provided for testability and future use.
   */
  onDismiss?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fade/slide transition duration in ms. */
const TRANSITION_MS = 250;

/** Time before the banner auto-dismisses in ms. */
const AUTO_DISMISS_MS = 5_000;

/** Extra spacing from the top edge of the player. */
const TOP_OFFSET_PX = 8;

/** Horizontal viewport padding guard. */
const VIEWPORT_MARGIN_PX = 8;

// ─── Module state ─────────────────────────────────────────────────────────────

/**
 * Handle for the auto-dismiss timer.
 * Cleared immediately on manual dismiss or hideWarningBanner() to prevent
 * a stale callback from removing a banner that is already gone.
 */
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Current player that the banner is anchored to.
 * Needed so scroll/resize handlers can reposition while the banner is visible.
 */
let currentAnchorPlayer: HTMLElement | null = null;

/** rAF handle for throttled position updates. */
let positionRafId: number | null = null;

/** Tracks whether global listeners are attached. */
let listenersAttached = false;

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Shows the warning banner anchored to the current player, but mounted into
 * document.body to avoid mutating YouTube's player subtree.
 *
 * Idempotent: if already visible, updates message/position and restarts the
 * auto-dismiss timer.
 */
export function showWarningBanner(player: HTMLElement, options: BannerOptions): void {
  const existing = document.getElementById(BANNER_ID) as HTMLDivElement | null;

  if (!player.isConnected) return;

  // If already visible, update the anchor/message and restart the timer.
  if (existing !== null) {
    currentAnchorPlayer = player;
    updateBannerMessage(existing, options.remainingSeconds);
    updateBannerPosition(existing, player);
    restartAutoDismiss(existing, options.onDismiss);
    ensureGlobalListeners();
    return;
  }

  // Build fully off-DOM before the frame.
  const banner = buildBanner(options);
  currentAnchorPlayer = player;

  requestAnimationFrame(() => {
    if (document.getElementById(BANNER_ID) !== null) return;
    if (!player.isConnected) return;

    try {
      document.body.appendChild(banner);
    } catch (err) {
      console.warn('[FocusCat] Warning banner mount failed, will retry:', err);
      return;
    }

    ensureGlobalListeners();
    updateBannerPosition(banner, player);

    // Commit the initial hidden state before transitioning to visible.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    banner.offsetHeight;

    banner.style.opacity = '1';
    banner.style.transform = 'translateY(0)';

    restartAutoDismiss(banner, options.onDismiss);
  });
}

/**
 * Removes the warning banner immediately (no animation).
 *
 * Called when:
 *   - State transitions to 'exceeded' — full overlay takes over
 *   - State transitions to 'under'   — no warning needed
 *   - destroyOverlayController()     — full teardown
 */
export function hideWarningBanner(): void {
  if (autoDismissTimer !== null) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  if (positionRafId !== null) {
    cancelAnimationFrame(positionRafId);
    positionRafId = null;
  }

  document.getElementById(BANNER_ID)?.remove();
  currentAnchorPlayer = null;
  teardownGlobalListenersIfIdle();
}

// ─── DOM construction ─────────────────────────────────────────────────────────

function buildBanner(options: BannerOptions): HTMLDivElement {
  const { remainingSeconds, onDismiss } = options;

  const root = document.createElement('div');
  root.id = BANNER_ID;
  root.style.cssText = joinStyles([
    'position: fixed',
    'top: 0',
    'left: 0',
    'z-index: 999998',
    'display: flex',
    'align-items: center',
    'justify-content: space-between',
    'gap: 12px',
    'padding: 10px 16px',
    'background: linear-gradient(135deg, #f59e0b, #f97316)',
    'color: #1a1a1a',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    'font-size: 13px',
    'font-weight: 500',
    'line-height: 1.4',
    'box-sizing: border-box',
    'border-bottom: 1px solid rgba(0, 0, 0, 0.08)',
    'border-radius: 0 0 12px 12px',
    'box-shadow: 0 8px 20px rgba(0, 0, 0, 0.18)',
    'opacity: 0',
    'transform: translateY(-10px)',
    `transition: opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease`,
    'pointer-events: all',
    'user-select: none',
    'max-width: calc(100vw - 16px)',
  ]);

  const messageRow = document.createElement('div');
  messageRow.style.cssText = joinStyles([
    'display: flex',
    'align-items: center',
    'gap: 8px',
    'flex: 1',
    'min-width: 0',
  ]);

  const catIcon = document.createElement('span');
  catIcon.setAttribute('aria-hidden', 'true');
  catIcon.style.cssText = joinStyles([
    'font-size: 16px',
    'line-height: 1',
    'flex-shrink: 0',
  ]);
  catIcon.textContent = '🐱';

  const text = document.createElement('span');
  text.setAttribute('data-role', 'message');
  text.textContent = buildMessage(remainingSeconds);
  text.style.cssText = joinStyles([
    'display: block',
    'min-width: 0',
    'overflow: hidden',
    'text-overflow: ellipsis',
    'white-space: nowrap',
  ]);

  messageRow.appendChild(catIcon);
  messageRow.appendChild(text);

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.setAttribute('aria-label', 'Dismiss warning');
  dismissBtn.style.cssText = joinStyles([
    'background: rgba(0, 0, 0, 0.12)',
    'border: none',
    'border-radius: 50%',
    'width: 22px',
    'height: 22px',
    'display: flex',
    'align-items: center',
    'justify-content: center',
    'cursor: pointer',
    'color: inherit',
    'font-size: 15px',
    'line-height: 1',
    'flex-shrink: 0',
    'padding: 0',
    'font-family: inherit',
    'transition: background 0.15s ease',
    'pointer-events: auto',
  ]);
  dismissBtn.textContent = '×';

  dismissBtn.addEventListener('mouseenter', () => {
    dismissBtn.style.background = 'rgba(0, 0, 0, 0.22)';
  });

  dismissBtn.addEventListener('mouseleave', () => {
    dismissBtn.style.background = 'rgba(0, 0, 0, 0.12)';
  });

  dismissBtn.addEventListener('click', () => {
    if (autoDismissTimer !== null) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
    animateOutAndRemove(root, onDismiss);
  });

  root.appendChild(messageRow);
  root.appendChild(dismissBtn);

  return root;
}

// ─── Positioning ─────────────────────────────────────────────────────────────

function updateBannerPosition(banner: HTMLDivElement, player: HTMLElement): void {
  if (!player.isConnected) {
    hideWarningBanner();
    return;
  }

  const rect = player.getBoundingClientRect();

  // If player is effectively not visible, remove the banner rather than leaving
  // it floating in a stale position.
  if (rect.width <= 0 || rect.height <= 0) {
    hideWarningBanner();
    return;
  }

  // If the player is fully outside the viewport, hide the banner visually
  // instead of pinning it to a stale edge position.
  if (rect.bottom <= 0 || rect.top >= window.innerHeight) {
    banner.style.visibility = 'hidden';
    banner.style.pointerEvents = 'none';
    return;
  }

  // Restore visibility when the player comes back into view.
  banner.style.visibility = 'visible';
  banner.style.pointerEvents = 'all';

  const left = clamp(
    rect.left,
    VIEWPORT_MARGIN_PX,
    Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - VIEWPORT_MARGIN_PX),
  );

  const top = Math.max(rect.top + TOP_OFFSET_PX, VIEWPORT_MARGIN_PX);

  const width = Math.max(
    0,
    Math.min(rect.width, window.innerWidth - VIEWPORT_MARGIN_PX * 2),
  );

  banner.style.left = `${left}px`;
  banner.style.top = `${top}px`;
  banner.style.width = `${width}px`;
}

function schedulePositionUpdate(): void {
  if (positionRafId !== null) return;

  positionRafId = requestAnimationFrame(() => {
    positionRafId = null;

    const banner = document.getElementById(BANNER_ID) as HTMLDivElement | null;
    const player = currentAnchorPlayer;

    if (banner === null || player === null) return;
    updateBannerPosition(banner, player);
  });
}

// ─── Lifecycle helpers ───────────────────────────────────────────────────────

function restartAutoDismiss(banner: HTMLDivElement, onDismiss?: () => void): void {
  if (autoDismissTimer !== null) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }

  autoDismissTimer = setTimeout(() => {
    autoDismissTimer = null;
    animateOutAndRemove(banner, onDismiss);
  }, AUTO_DISMISS_MS);
}

function updateBannerMessage(banner: HTMLDivElement, remainingSeconds: number): void {
  const text = banner.querySelector('[data-role="message"]');
  if (!(text instanceof HTMLSpanElement)) return;
  text.textContent = buildMessage(remainingSeconds);
}

function ensureGlobalListeners(): void {
  if (listenersAttached) return;

  window.addEventListener('scroll', schedulePositionUpdate, { passive: true });
  window.addEventListener('resize', schedulePositionUpdate, { passive: true });
  listenersAttached = true;
}

function teardownGlobalListenersIfIdle(): void {
  if (document.getElementById(BANNER_ID) !== null) return;
  if (!listenersAttached) return;

  window.removeEventListener('scroll', schedulePositionUpdate);
  window.removeEventListener('resize', schedulePositionUpdate);
  listenersAttached = false;
}

// ─── Animation helpers ────────────────────────────────────────────────────────

function animateOutAndRemove(banner: HTMLElement, onDismiss?: () => void): void {
  banner.style.opacity = '0';
  banner.style.transform = 'translateY(-10px)';

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    banner.remove();
    currentAnchorPlayer = null;
    teardownGlobalListenersIfIdle();
    onDismiss?.();
  };

  banner.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, TRANSITION_MS + 50);
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function joinStyles(declarations: string[]): string {
  return declarations.join('; ');
}

function buildMessage(remainingSeconds: number): string {
  if (remainingSeconds < 60) {
    return 'Almost there! Less than a minute of YouTube left today.';
  }

  const minutes = Math.ceil(remainingSeconds / 60);
  const unit = minutes === 1 ? 'minute' : 'minutes';
  return `Almost there! ${minutes} ${unit} of YouTube left today.`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}