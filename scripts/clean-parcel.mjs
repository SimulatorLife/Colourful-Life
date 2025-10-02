#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { cwd } from "node:process";

const targetDirs = ["dist", ".parcel-cache"];

async function removePath(path) {
  const fullPath = resolve(cwd(), path);

  try {
    await rm(fullPath, { recursive: true, force: true });
    console.log(`Removed ${path}`);
  } catch (error) {
    console.error(`Failed to remove ${path}: ${error.message}`);
    throw error;
  }
}

(async () => {
  try {
    await Promise.all(targetDirs.map(removePath));
    console.log("Parcel artifacts cleaned.");
  } catch (error) {
    process.exitCode = 1;
  }
})();
