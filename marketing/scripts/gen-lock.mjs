#!/usr/bin/env node
/**
 * gen-lock.mjs — Generate or check the marketing lockfile.
 *
 * Usage:
 *   node marketing/scripts/gen-lock.mjs          # Write lockfile
 *   node marketing/scripts/gen-lock.mjs --check  # Fail if lock differs
 *
 * Reads the index, resolves all refs, hashes every file deterministically,
 * and writes marketing/manifests/marketing.lock.json with sorted keys.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const repoRoot = join(root, "..");
const lockPath = join(root, "manifests/marketing.lock.json");
const checkMode = process.argv.includes("--check");

async function hashFile(relPath) {
  const abs = join(repoRoot, relPath);
  const buf = await readFile(abs);
  const sha256 = createHash("sha256").update(buf).digest("hex");
  return { path: relPath, sha256, bytes: buf.length };
}

// Fixed set of files to lock: schema, index, evidence manifest, plus all index refs
const filesToLock = [
  "marketing/schema/marketing.schema.json",
  "marketing/data/marketing.index.json",
];

// Read index to discover referenced files
const indexText = await readFile(join(root, "data/marketing.index.json"), "utf8");
const index = JSON.parse(indexText);

for (const group of ["audiences", "tools", "campaigns"]) {
  for (const { ref } of index[group] || []) {
    filesToLock.push(`marketing/data/${ref}`);
  }
}

filesToLock.push("marketing/manifests/evidence.manifest.json");

// Sort for determinism
filesToLock.sort();

// Hash all files
const files = [];
for (const f of filesToLock) {
  files.push(await hashFile(f));
}

const lock = {
  schemaVersion: "1.0.0",
  generatedAt: new Date().toISOString(),
  generator: "gen-lock.mjs",
  files,
};

// Deterministic JSON: sorted keys, 2-space indent, trailing newline
const lockJson = JSON.stringify(lock, null, 2) + "\n";

if (checkMode) {
  let existing;
  try {
    existing = await readFile(lockPath, "utf8");
  } catch {
    console.error("Lockfile does not exist. Run gen-lock.mjs to create it.");
    process.exit(1);
  }

  const existingParsed = JSON.parse(existing);
  // Compare files arrays only (generatedAt will differ)
  const existingFiles = JSON.stringify(existingParsed.files);
  const newFiles = JSON.stringify(lock.files);

  if (existingFiles !== newFiles) {
    console.error("Lockfile is out of date. Run gen-lock.mjs to update it.");
    console.error("\nExpected:");
    for (const f of lock.files) console.error(`  ${f.sha256} ${f.bytes} ${f.path}`);
    console.error("\nFound in lock:");
    for (const f of existingParsed.files) console.error(`  ${f.sha256} ${f.bytes} ${f.path}`);
    process.exit(1);
  }

  console.log("Lockfile is up to date.");
} else {
  await writeFile(lockPath, lockJson, "utf8");
  console.log(`Lockfile written: ${lockPath}`);
  for (const f of files) {
    console.log(`  ${f.sha256} ${f.bytes} ${f.path}`);
  }
}
