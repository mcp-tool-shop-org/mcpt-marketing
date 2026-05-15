#!/usr/bin/env node
/**
 * hash-file.mjs — Compute sha256 + bytes for a file.
 * Usage: node marketing/scripts/hash-file.mjs <path>
 * Output: JSON { path, sha256, bytes }
 *
 * The emitted `path` field is normalized to POSIX separators so the same file
 * always produces the same JSON regardless of how the user typed the argument.
 * Addresses F-SCRIPTS-010.
 *
 * Errors are wrapped in a one-line envelope (no Node stack trace).
 * Addresses F-SCRIPTS-009.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node hash-file.mjs <path>");
    process.exit(1);
  }

  const abs = resolve(filePath);
  let buf;
  try {
    buf = await readFile(abs);
  } catch (err) {
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
  const sha256 = createHash("sha256").update(buf).digest("hex");

  // Normalize to POSIX separators so output is identical regardless of how the
  // user typed the path (Windows backslashes would otherwise leak into JSON).
  const normalizedPath = filePath.replace(/\\/g, "/");

  console.log(JSON.stringify({ path: normalizedPath, sha256, bytes: buf.length }, null, 2));
}

main().catch((err) => {
  console.error(`hash-file.mjs failed: ${err.message}`);
  process.exit(1);
});
