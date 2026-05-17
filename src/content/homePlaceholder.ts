// src/content/homePlaceholder.ts
// Injects a cat placeholder card into the YouTube home page when
// home recommendations are hidden. Replaces the empty space with a
// friendly prompt so the user acts intentionally rather than scrolling blind.

const PLACEHOLDER_ID = 'focus-cat-home-placeholder';
const CAT_URL = chrome.runtime.getURL('assets/cat/cutycat.png');

function buildCard(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.id = PLACEHOLDER_ID;
  wrap.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:center',
    'padding:80px 20px 60px',
    'box-sizing:border-box',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif',
  ].join(';');

  const img = document.createElement('img');
  img.src = CAT_URL;
  img.alt = '';
  img.style.cssText = [
    'width:140px',
    'height:140px',
    'object-fit:contain',
    'display:block',
    'margin-bottom:24px',
  ].join(';');
  img.animate(
    [
      { transform: 'translateY(0px) rotate(0deg)' },
      { transform: 'translateY(-10px) rotate(-2deg)' },
      { transform: 'translateY(0px) rotate(0deg)' },
    ],
    { duration: 3000, iterations: Infinity, easing: 'ease-in-out' },
  );

  const heading = document.createElement('p');
  heading.style.cssText = [
    'margin:0 0 8px',
    'font-size:22px',
    'font-weight:600',
    'color:#0f0f0f',
    'text-align:center',
    'line-height:1.3',
  ].join(';');
  heading.textContent = 'What would you like to watch?';

  const sub = document.createElement('p');
  sub.style.cssText = [
    'margin:0',
    'font-size:15px',
    'color:#606060',
    'text-align:center',
  ].join(';');
  sub.textContent = 'Search for something specific to get started.';

  wrap.appendChild(img);
  wrap.appendChild(heading);
  wrap.appendChild(sub);
  return wrap;
}

/**
 * Injects the cat placeholder into the YouTube home page content area.
 * Idempotent — safe to call multiple times; only inserts once.
 */
export function injectHomePlaceholder(): void {
  if (document.getElementById(PLACEHOLDER_ID)) return;

  const host =
    document.querySelector<Element>('ytd-browse[page-subtype="home"] #contents') ??
    document.querySelector<Element>('ytd-browse[page-subtype="home"]');
  if (!host) return;

  host.insertAdjacentElement('afterbegin', buildCard());
}

/**
 * Removes the cat placeholder if present.
 */
export function removeHomePlaceholder(): void {
  document.getElementById(PLACEHOLDER_ID)?.remove();
}
