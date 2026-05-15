#!/usr/bin/env node
/**
 * gen-lock.mjs — Generate or check the marketing lockfile.
 *
 * Usage:
 *   node marketing/scripts/gen-lock.mjs          # Write lockfile
 *   node marketing/scripts/gen-lock.mjs --check  # Fail if lock differs
 *
 * Reads the index, resolves all refs, hashes every file deterministically,
 * and writes marketing/manifests/marketing.lock.json.
 *
 * Determinism contract:
 *   - No timestamps in output (lockfile precedent: package-lock.json, Cargo.lock).
 *     The lock's value comes from the file hashes, not from when it was minted.
 *     Addresses F-SCRIPTS-002.
 *   - JSON output uses a key-sorting replacer so emit order is independent of
 *     code-side property ordering. Addresses F-SCRIPTS-003.
 *   - filesToLock[] is sorted alphabetically by `path` before hashing.
 *   - --check mode performs a per-entry diff (path, sha256, bytes) so an
 *     accidental property reordering does not look like data drift.
 *     Addresses F-SCRIPTS-008.
 *
 * Error model: any uncaught exception is wrapped in a one-line envelope so the
 * user sees an actionable message instead of a Node.js stack. Addresses
 * F-SCRIPTS-009.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ALWAYS_LOCK, INDEX_PATH, LOCK_PATH, assertSafeRef, repoRoot } from "./_paths.mjs";

async function hashFile(relPath) {
  const abs = join(repoRoot, relPath);
  let buf;
  try {
    buf = await readFile(abs);
  } catch (err) {
    throw new Error(`Failed to read ${relPath}: ${err.message}`);
  }
  const sha256 = createHash("sha256").update(buf).digest("hex");
  return { path: relPath, sha256, bytes: buf.length };
}

/**
 * Stable JSON replacer that sorts object keys alphabetically at every level.
 * Arrays are emitted in their existing order (the caller is responsible for
 * sorting array contents when determinism is required — see filesToLock.sort()).
 */
function sortKeysReplacer(key, value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, value[k]]),
    );
  }
  return value;
}

async function loadJson(relPath, source) {
  const abs = join(repoRoot, relPath);
  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch (err) {
    throw new Error(`Failed to read ${source} (${relPath}): ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${source} (${relPath}) as JSON: ${err.message}`);
  }
}

async function main() {
  const checkMode = process.argv.includes("--check");

  // Build the file list: always-locked artifacts + index-discovered refs.
  const filesToLock = [...ALWAYS_LOCK];

  const index = await loadJson(INDEX_PATH, "marketing index");
  for (const group of ["audiences", "tools", "campaigns"]) {
    for (const entry of index[group] || []) {
      const ref = assertSafeRef(entry.ref, `marketing.index.json[${group}]`);
      filesToLock.push(`marketing/data/${ref}`);
    }
  }

  // Sort for determinism (alphabetical by path).
  filesToLock.sort();

  // Hash all files.
  const files = [];
  for (const f of filesToLock) {
    files.push(await hashFile(f));
  }

  // Note: NO `generatedAt` field. Drift is captured by the file hashes.
  const lock = {
    schemaVersion: "1.0.0",
    generator: "gen-lock.mjs",
    files,
  };

  // Deterministic JSON: sorted keys + 2-space indent + trailing newline.
  const lockJson = JSON.stringify(lock, sortKeysReplacer, 2) + "\n";

  if (checkMode) {
    const lockAbs = join(repoRoot, LOCK_PATH);
    let existingText;
    try {
      existingText = await readFile(lockAbs, "utf8");
    } catch {
      throw new Error(`Lockfile does not exist at ${LOCK_PATH}. Run 'npm run lock' to create it.`);
    }

    // Per-entry diff: more informative than a wall of identical-looking sha256s.
    let existingParsed;
    try {
      existingParsed = JSON.parse(existingText);
    } catch (err) {
      throw new Error(`Lockfile at ${LOCK_PATH} is not valid JSON: ${err.message}`);
    }

    const existingByPath = new Map((existingParsed.files || []).map((f) => [f.path, f]));
    const newByPath = new Map(files.map((f) => [f.path, f]));

    const diffs = [];
    // Files present in the new lock.
    for (const [path, newEntry] of newByPath) {
      const oldEntry = existingByPath.get(path);
      if (!oldEntry) {
        diffs.push(`  + ${path} (new file, sha256=${newEntry.sha256}, bytes=${newEntry.bytes})`);
        continue;
      }
      if (oldEntry.sha256 !== newEntry.sha256 || oldEntry.bytes !== newEntry.bytes) {
        diffs.push(
          `  ~ ${path}: sha256 ${oldEntry.sha256} -> ${newEntry.sha256}, bytes ${oldEntry.bytes} -> ${newEntry.bytes}`,
        );
      }
    }
    // Files removed from the new lock.
    for (const [path, oldEntry] of existingByPath) {
      if (!newByPath.has(path)) {
        diffs.push(`  - ${path} (removed, was sha256=${oldEntry.sha256}, bytes=${oldEntry.bytes})`);
      }
    }

    // Also check the rendered bytes — catches accidental reorderings or
    // metadata drift the file-level diff would miss.
    const bytesEqual = existingText === lockJson;

    if (diffs.length > 0 || !bytesEqual) {
      console.error("Lockfile is out of date. Run 'npm run lock' to update it.");
      if (diffs.length > 0) {
        console.error("\nFile-level changes:");
        for (const d of diffs) console.error(d);
      }
      if (bytesEqual === false && diffs.length === 0) {
        console.error(
          "\nLockfile bytes drift detected (likely metadata reorder). Regenerate to normalize.",
        );
      }
      process.exit(1);
    }

    console.log("Lockfile is up to date.");
  } else {
    const lockAbs = join(repoRoot, LOCK_PATH);
    await writeFile(lockAbs, lockJson, "utf8");
    console.log(`Lockfile written: ${lockAbs}`);
    for (const f of files) {
      console.log(`  ${f.sha256} ${f.bytes} ${f.path}`);
    }
  }
}

main().catch((err) => {
  console.error(`gen-lock.mjs failed: ${err.message}`);
  process.exit(1);
});
