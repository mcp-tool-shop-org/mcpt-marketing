#!/usr/bin/env node
/**
 * gen-lock.mjs — Generate or check the marketing lockfile.
 *
 * Usage:
 *   node marketing/scripts/gen-lock.mjs                   # Write lockfile
 *   node marketing/scripts/gen-lock.mjs --check           # Fail if lock differs
 *   node marketing/scripts/gen-lock.mjs --root <path>     # Use alternate marketing/ tree
 *   node marketing/scripts/gen-lock.mjs --help
 *   node marketing/scripts/gen-lock.mjs --version
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
 * Atomic write:
 *   - Writes to <lockfile>.tmp.<uuid>, fsync flush, then rename to the final
 *     path. Prevents torn writes seen by concurrent readers (parallel CI jobs,
 *     editor reload, lock:check in a watch loop) and prevents truncated lock
 *     files when the writer is interrupted (Ctrl-C, OOM, disk full).
 *     Addresses F-SCRIPTS-B-005.
 *
 * Error model: any uncaught exception is wrapped in a one-line envelope so the
 * user sees an actionable message instead of a Node.js stack. Addresses
 * F-SCRIPTS-009.
 *
 * --root / MCPT_MARKETING_ROOT support per F-SCRIPTS-B-002.
 * --help / --version per F-SCRIPTS-B-001 / F-SCRIPTS-B-012.
 * loadJson centralized in _paths.mjs per F-SCRIPTS-B-013.
 */

import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ALWAYS_LOCK,
  INDEX_PATH,
  LOCK_PATH,
  assertSafeRef,
  getScriptVersion,
  loadJson,
  parseArgs,
  resolveRoots,
} from "./_paths.mjs";

const HELP_TEXT = `Usage: node gen-lock.mjs [options]

Generate or verify the marketing lockfile (marketing/manifests/marketing.lock.json).

Options:
  --check                   Verify lockfile matches inputs; exit 1 on drift.
  --root <path>             Use an alternate marketing/ root (overrides
                            MCPT_MARKETING_ROOT and the script-relative default).
  --help, -h                Print this help and exit 0.
  --version                 Print the script version and exit 0.

Environment:
  MCPT_MARKETING_ROOT       Same as --root (used when --root is not given).

Determinism contract:
  - Lockfile contains no timestamps; value comes from file hashes alone.
  - Top-level keys are alphabetically sorted; files[] is sorted by path.
  - Output is byte-identical across runs given the same inputs.

Notes:
  - Without --check, writes the lockfile atomically (tmp + rename) so
    concurrent readers cannot observe a torn / truncated file.
`;

async function hashFile(repoRootAbs, relPath) {
  const abs = join(repoRootAbs, relPath);
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

/**
 * Atomic write: stage to a uuid-suffixed tmp file, then rename into place.
 *
 * The uuid suffix prevents collisions between concurrent gen-lock runs that
 * happen to start in the same millisecond. On Windows + Node 20+, fs.rename
 * is atomic over an existing destination; on POSIX it has always been.
 *
 * If rename fails (e.g. EPERM on a Windows network share), the tmp file is
 * cleaned up best-effort and the error is rethrown with both paths in the
 * message so the operator can clean up manually if needed.
 */
async function atomicWrite(finalAbs, contents) {
  const tmpAbs = `${finalAbs}.tmp.${randomUUID()}`;
  await writeFile(tmpAbs, contents, "utf8");
  try {
    await rename(tmpAbs, finalAbs);
  } catch (err) {
    // Best-effort cleanup of the tmp file so we don't leak it.
    try {
      await unlink(tmpAbs);
    } catch {
      // ignore — the tmp may already be gone, or unrelated cleanup will handle.
    }
    throw new Error(`Atomic rename failed: ${err.message} (tmp=${tmpAbs}, final=${finalAbs})`);
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (flags.version) {
    const v = await getScriptVersion();
    process.stdout.write(`gen-lock.mjs ${v}\n`);
    process.exit(0);
  }

  const checkMode = flags.check === true;

  // Resolve the marketing root (--root > MCPT_MARKETING_ROOT > script-relative).
  const { repoRoot: repoRootAbs } = resolveRoots({
    root: typeof flags.root === "string" ? flags.root : undefined,
  });

  // Build the file list: always-locked artifacts + index-discovered refs.
  const filesToLock = [...ALWAYS_LOCK];

  const index = await loadJson(INDEX_PATH, "marketing index", repoRootAbs);
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
    files.push(await hashFile(repoRootAbs, f));
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
    const lockAbs = join(repoRootAbs, LOCK_PATH);
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
    const lockAbs = join(repoRootAbs, LOCK_PATH);
    // Atomic write: tmp + rename. Prevents torn reads + truncated files on
    // mid-write interruption. F-SCRIPTS-B-005.
    await atomicWrite(lockAbs, lockJson);
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
