// build.mjs
// esbuild orchestration for Focus Cat for YouTube.
//
// Produces four bundles into dist/:
//   background.js  — MV3 service worker (ESM, Chrome can load native ES modules)
//   content.js     — content script     (IIFE, injected into page context)
//   popup/index.js — toolbar popup      (IIFE)
//   options/index.js — settings page    (IIFE)
//
// Usage:
//   node build.mjs           → one-shot production build
//   node build.mjs --watch   → incremental rebuild on file changes (dev)

import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

const bundles = [
  {
    entryPoints: ['src/background/index.ts'],
    outfile: 'dist/background.js',
    format: /** @type {const} */ ('esm'),
  },
  {
    entryPoints: ['src/content/index.ts'],
    outfile: 'dist/content.js',
    format: /** @type {const} */ ('iife'),
  },
  {
    entryPoints: ['src/popup/index.ts'],
    outfile: 'dist/popup/index.js',
    format: /** @type {const} */ ('iife'),
  },
  {
    entryPoints: ['src/options/index.ts'],
    outfile: 'dist/options/index.js',
    format: /** @type {const} */ ('iife'),
  },
];

if (isWatch) {
  const contexts = await Promise.all(
    bundles.map((b) => esbuild.context({ ...shared, ...b })),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('[FocusCat] Watching for changes — Ctrl+C to stop.');
} else {
  await Promise.all(bundles.map((b) => esbuild.build({ ...shared, ...b })));
  console.log('[FocusCat] Build complete.');
}
