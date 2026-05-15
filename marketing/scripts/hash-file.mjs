#!/usr/bin/env node
/**
 * hash-file.mjs — Compute sha256 + bytes for a file.
 *
 * Usage:
 *   node marketing/scripts/hash-file.mjs <path>
 *   node marketing/scripts/hash-file.mjs --help
 *   node marketing/scripts/hash-file.mjs --version
 *
 * Output: JSON { path, sha256, bytes }
 *
 * The emitted `path` field is normalized to POSIX separators so the same file
 * always produces the same JSON regardless of how the user typed the argument.
 * Addresses F-SCRIPTS-010.
 *
 * Errors are wrapped in a one-line envelope (no Node stack trace).
 * Addresses F-SCRIPTS-009.
 *
 * --help / --version added per F-SCRIPTS-B-001 / F-SCRIPTS-B-012.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getScriptVersion, parseArgs } from "./_paths.mjs";

const HELP_TEXT = `Usage: node hash-file.mjs <path> [options]

Compute sha256 + bytes for a single file. Output is JSON on stdout:
  { "path": "<posix-normalized>", "sha256": "<hex>", "bytes": <number> }

Options:
  --help, -h       Print this help and exit 0.
  --version        Print the script version and exit 0.

Notes:
  - Emitted path is POSIX-normalized (backslashes -> forward slashes) so the
    same file always produces the same JSON regardless of platform / typing.
  - Errors are wrapped in a one-line envelope (no Node stack trace).
`;

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }

  if (flags.version) {
    const v = await getScriptVersion();
    process.stdout.write(`hash-file.mjs ${v}\n`);
    process.exit(0);
  }

  const filePath = positional[0];
  if (!filePath) {
    console.error("Usage: node hash-file.mjs <path>  (run with --help for full options)");
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
