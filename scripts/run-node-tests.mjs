import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const WATCH_FALSE_VALUES = new Set(["", "false", "0", "off", "no"]);
const WATCH_TRUE_VALUES = new Set(["true", "1", "on", "yes"]);
const WATCH_FLAG_ALIASES = new Map([
  ["--watch", "--watch"],
  ["--watchAll", "--watch"],
  ["--watch-all", "--watch"],
]);
const TEST_FILE_PATTERN = /\.test\.(?:[cm]?js)$/i;

export function normalizeTestRunnerArgs(rawArgs = []) {
  const flags = [];
  const paths = [];

  const args = Array.isArray(rawArgs) ? rawArgs : [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      paths.push(...args.slice(index + 1));
      break;
    }

    if (WATCH_FLAG_ALIASES.has(arg)) {
      const next = args[index + 1];
      const normalizedFlag = WATCH_FLAG_ALIASES.get(arg);

      if (next && !next.startsWith("-")) {
        const value = String(next).trim().toLowerCase();

        if (WATCH_FALSE_VALUES.has(value)) {
          index += 1;
          continue;
        }

        if (WATCH_TRUE_VALUES.has(value)) {
          flags.push(normalizedFlag);
          index += 1;
          continue;
        }

        flags.push(`${normalizedFlag}=${next}`);
        index += 1;
        continue;
      }

      flags.push(normalizedFlag);
      continue;
    }

    if (typeof arg === "string") {
      let handled = false;

      for (const [alias, normalizedFlag] of WATCH_FLAG_ALIASES) {
        if (!arg.startsWith(`${alias}=`)) {
          continue;
        }

        const rawValue = arg.slice(alias.length + 1);
        const value = rawValue.trim().toLowerCase();

        if (WATCH_FALSE_VALUES.has(value)) {
          handled = true;
          break;
        }

        if (WATCH_TRUE_VALUES.has(value)) {
          flags.push(normalizedFlag);
          handled = true;
          break;
        }

        flags.push(`${normalizedFlag}=${rawValue}`);
        handled = true;
        break;
      }

      if (handled) {
        continue;
      }
    }

    if (typeof arg === "string" && arg.startsWith("--watch=")) {
      const value = arg.slice("--watch=".length).trim().toLowerCase();

      if (WATCH_FALSE_VALUES.has(value)) {
        continue;
      }

      if (WATCH_TRUE_VALUES.has(value)) {
        flags.push("--watch");
        continue;
      }

      flags.push(arg);
      continue;
    }

    if (typeof arg === "string" && arg.startsWith("-")) {
      flags.push(arg);
      continue;
    }

    paths.push(arg);
  }

  return { flags, paths };
}

function normalizeRunnerPath(filePath) {
  const relative = path.relative(process.cwd(), filePath);

  if (!relative || relative.startsWith("..")) {
    return filePath;
  }

  return relative || filePath;
}

async function collectDirectoryTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectDirectoryTests(fullPath)));
      continue;
    }

    if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function expandTestTargets(rawTargets) {
  const targets =
    Array.isArray(rawTargets) && rawTargets.length > 0 ? rawTargets : ["test"];
  const resolved = [];
  const seen = new Set();

  for (const target of targets) {
    if (typeof target !== "string" || target.length === 0) continue;

    const absolute = path.resolve(process.cwd(), target);
    let stats;

    try {
      stats = await stat(absolute);
    } catch {
      if (!seen.has(target)) {
        seen.add(target);
        resolved.push(target);
      }
      continue;
    }

    if (stats.isDirectory()) {
      const files = await collectDirectoryTests(absolute);

      for (const file of files) {
        const normalized = normalizeRunnerPath(file);

        if (seen.has(normalized)) continue;
        seen.add(normalized);
        resolved.push(normalized);
      }

      continue;
    }

    if (stats.isFile()) {
      const normalized = normalizeRunnerPath(absolute);

      if (seen.has(normalized)) continue;
      seen.add(normalized);
      resolved.push(normalized);
      continue;
    }

    if (seen.has(target)) continue;
    seen.add(target);
    resolved.push(target);
  }

  return resolved;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (signal) {
        const signalCode = typeof signal === "string" ? 128 + signal.charCodeAt(0) : 1;

        resolve(signalCode);

        return;
      }

      resolve(code ?? 0);
    });
  });
}

export async function runNodeTests(rawArgs = []) {
  const benchmarkCode = await run(process.execPath, ["scripts/profile-energy.mjs"]);

  if (benchmarkCode !== 0) {
    return benchmarkCode;
  }

  const { flags, paths } = normalizeTestRunnerArgs(rawArgs);
  const targets = await expandTestTargets(paths);

  if (targets.length === 0) {
    console.error(
      paths && paths.length > 0
        ? `No test files found for ${paths.join(", ")}.`
        : "No test files found under the test directory.",
    );
    return 1;
  }

  const testArgs = ["--test", ...flags, ...targets];

  return run(process.execPath, testArgs);
}

async function cli() {
  const exitCode = await runNodeTests(process.argv.slice(2));

  process.exit(exitCode);
}

const isExecutedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch (error) {
    return false;
  }
})();

if (isExecutedDirectly) {
  cli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
