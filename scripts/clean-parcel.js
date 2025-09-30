#!/usr/bin/env node
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Removes the provided path if it exists.
 *
 * @param {string} target - Absolute path to delete.
 * @returns {Promise<boolean>} Whether the path was removed.
 */
async function deleteIfExists(target) {
  try {
    await stat(target);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }

  await rm(target, { recursive: true, force: true });

  return true;
}

/**
 * Entry point that deletes the Parcel cache and build output directories.
 */
async function main() {
  const root = resolve(process.cwd());
  const targets = [".parcel-cache", "dist"].map((relative) => resolve(root, relative));
  const results = await Promise.all(targets.map(deleteIfExists));

  results.forEach((removed, index) => {
    const name = targets[index];

    if (removed) {
      console.log(`Removed ${name}`);
    } else {
      console.log(`Skipped ${name} (not found)`);
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
