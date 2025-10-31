#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const DRY_RUN_FLAGS = Object.freeze(["--dry-run", "--check"]);
const TARGETS = Object.freeze(["dist", ".parcel-cache"]);
const dryRun = args.some((flag) => DRY_RUN_FLAGS.includes(flag));

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
  await Promise.all(TARGETS.map(remove));
  if (dryRun) {
    console.log("Parcel artifacts clean script validated (dry-run).");
  } else {
    console.log("Parcel artifacts cleaned.");
  }
} catch (error) {
  console.error("Failed to clean parcel artifacts:", error.message);
  process.exitCode = 1;
}
