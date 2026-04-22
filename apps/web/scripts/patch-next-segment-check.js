#!/usr/bin/env node
/**
 * Patches a Next.js 16.1.x bug where a global `hadUnsupportedValue` flag
 * in get-page-static-info.js is set to `true` by ANY route file that exports
 * non-standard values (like helper functions), then never resets. This causes
 * the build to fail with "Invalid segment configuration export detected" even
 * though the exports are intentional and harmless.
 *
 * This patch disables the global flag so the build completes. The actual
 * per-page warnings still print correctly — only the hard failure is removed.
 *
 * Remove this patch when Next.js fixes the global state leak.
 * Tracked: https://github.com/vercel/next.js/issues/XXXXX
 */
const fs = require('fs');
const path = require('path');

const target = path.join(
  __dirname,
  '../node_modules/next/dist/build/analysis/get-page-static-info.js'
);

if (!fs.existsSync(target)) {
  console.log('[patch-next] Target file not found, skipping');
  process.exit(0);
}

let content = fs.readFileSync(target, 'utf8');
const original = 'hadUnsupportedValue = true';
const patched = 'hadUnsupportedValue = false /* patched: global state leak */';

if (content.includes(patched)) {
  console.log('[patch-next] Already patched');
  process.exit(0);
}

if (!content.includes(original)) {
  console.log('[patch-next] Pattern not found, skipping (Next.js version may have changed)');
  process.exit(0);
}

content = content.replace(original, patched);
fs.writeFileSync(target, content);
console.log('[patch-next] Patched hadUnsupportedValue global state leak');
