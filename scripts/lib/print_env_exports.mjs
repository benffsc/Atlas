#!/usr/bin/env node
/**
 * print_env_exports.mjs - Safely parse .env and output shell exports
 * DEV_013: Fixes DATABASE_URL truncation when password contains # or other shell chars
 *
 * Usage:
 *   eval "$(node scripts/print_env_exports.mjs .env)"
 *   eval "$(node scripts/print_env_exports.mjs)"  # defaults to .env in cwd
 *
 * This script:
 * 1. Reads .env as plain text (not shell-sourced)
 * 2. Parses KEY=VALUE preserving # and special chars in values
 * 3. Outputs: export KEY='value' with proper shell escaping
 *
 * Why this is needed:
 * - `source .env` treats # as comment start, truncating passwords like "abc#def"
 * - Node's dotenv has similar issues with certain chars
 * - This script handles all chars by using single-quote escaping
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const envPath = process.argv[2] || '.env';
const fullPath = resolve(process.cwd(), envPath);

let content;
try {
  content = readFileSync(fullPath, 'utf8');
} catch (e) {
  // File doesn't exist - not an error, just no exports
  process.exit(0);
}

const lines = content.split('\n');

for (const line of lines) {
  // Skip empty lines and comments
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    continue;
  }

  // Find first = to split key and value
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) {
    continue;
  }

  // Extract key (strip optional 'export ' prefix)
  let key = trimmed.slice(0, eqIndex).trim();
  if (key.startsWith('export ')) {
    key = key.slice(7).trim();
  }

  // Skip invalid key names
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    continue;
  }

  // Extract value - everything after the first =
  let value = trimmed.slice(eqIndex + 1);

  // Handle quoted values
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    // Remove outer quotes
    value = value.slice(1, -1);
  }

  // Escape single quotes for shell output: ' -> '\''
  const escaped = value.replace(/'/g, "'\\''");

  // Output as shell export with single quotes (safest for special chars)
  console.log(`export ${key}='${escaped}'`);
}
