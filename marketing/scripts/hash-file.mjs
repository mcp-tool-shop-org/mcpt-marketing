#!/usr/bin/env node
/**
 * hash-file.mjs — Compute sha256 + bytes for a file.
 * Usage: node marketing/scripts/hash-file.mjs <path>
 * Output: JSON { path, sha256, bytes }
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node hash-file.mjs <path>");
  process.exit(1);
}

const abs = resolve(filePath);
const buf = await readFile(abs);
const sha256 = createHash("sha256").update(buf).digest("hex");

console.log(JSON.stringify({ path: filePath, sha256, bytes: buf.length }, null, 2));
