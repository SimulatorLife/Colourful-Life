#!/usr/bin/env node
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--check');
const targets = ['dist', '.parcel-cache'];

async function remove(target) {
  const fullPath = resolve(rootDir, target);

  if (dryRun) {
    console.log(`[dry-run] Would remove ${target} (${fullPath})`);
    return;
  }

  await rm(fullPath, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}

try {
  await Promise.all(targets.map(remove));
  if (dryRun) {
    console.log('Parcel artifacts clean script validated (dry-run).');
  } else {
    console.log('Parcel artifacts cleaned.');
  }
} catch (error) {
  console.error('Failed to clean parcel artifacts:', error.message);
  process.exitCode = 1;
}
