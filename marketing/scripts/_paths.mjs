/**
 * _paths.mjs — Single source of truth for canonical file paths.
 *
 * All three scripts (validate.mjs, gen-lock.mjs, hash-file.mjs) consume this
 * module so that moving or adding a top-level artifact only requires editing
 * one place. Addresses F-SCRIPTS-011.
 *
 * Paths are repo-relative (anchored at the repo root, not at marketing/).
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// marketing/scripts/_paths.mjs -> marketing/  (one level up)
export const marketingRoot = join(__dirname, "..");
// marketing/scripts/_paths.mjs -> repo root  (two levels up)
export const repoRoot = join(__dirname, "..", "..");

// Canonical artifact locations (repo-relative POSIX strings).
export const SCHEMA_PATH = "marketing/schema/marketing.schema.json";
export const INDEX_PATH = "marketing/data/marketing.index.json";
export const EVIDENCE_MANIFEST_PATH = "marketing/manifests/evidence.manifest.json";
export const LOCK_PATH = "marketing/manifests/marketing.lock.json";

// Always-locked files (does NOT include index-discovered refs — gen-lock.mjs
// appends those at runtime).
export const ALWAYS_LOCK = [SCHEMA_PATH, INDEX_PATH, EVIDENCE_MANIFEST_PATH];

/**
 * Validate a ref string from index/manifest before joining it into a filesystem path.
 *
 * Rejects:
 *   - any ".." segment (path traversal)
 *   - any "." segment (self-reference, e.g. "foo/./bar")
 *   - leading dots in any segment (so ".env", ".git/config" are blocked)
 *   - leading slashes (absolute paths)
 *   - backslashes (Windows separators leaking through)
 *   - empty strings
 *
 * Accepts:
 *   - "subdir/file.json"
 *   - "tools/zip-meta-map.json"
 *
 * Throws on rejection so the caller's error envelope reports a clear message.
 * Addresses F-SCRIPTS-007 / F-SCRIPTS-W3-001.
 */
// Each segment must start with [a-zA-Z0-9_-] (no leading dot), then may contain
// [a-zA-Z0-9._-]. This blocks ".env.json", "foo/./bar.json", and ".git/x.json"
// at the regex level (no leading-dot segments anywhere). The trailing `.json`
// requirement is preserved.
const REF_PATTERN = /^([a-zA-Z0-9_][a-zA-Z0-9._-]*)(\/[a-zA-Z0-9_][a-zA-Z0-9._-]*)*\.json$/;
export function assertSafeRef(ref, source = "(unknown)") {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new Error(`Unsafe ref in ${source}: ref must be a non-empty string`);
  }
  if (ref.includes("..") || ref.startsWith("/") || ref.includes("\\")) {
    throw new Error(
      `Unsafe ref in ${source}: ${JSON.stringify(ref)} contains '..', leading '/', or '\\\\'`,
    );
  }
  if (!REF_PATTERN.test(ref)) {
    throw new Error(`Unsafe ref in ${source}: ${JSON.stringify(ref)} must match ${REF_PATTERN}`);
  }
  return ref;
}

/**
 * Same as assertSafeRef but for evidence-manifest path strings, which may
 * point at any file under marketing/ (e.g. "evidence/dashboard.png").
 *
 * Allows arbitrary file extensions and nested paths, but still rejects:
 *   - '..' (path traversal)
 *   - '.' as a standalone segment (self-reference)
 *   - leading dots in any segment (so ".env", ".git/foo" are blocked)
 *   - absolute paths and backslashes
 *
 * Addresses F-SCRIPTS-007 / F-SCRIPTS-W3-001.
 */
// Each segment must start with [a-zA-Z0-9_-] (no leading dot). Blocks
// ".env", ".git/config", "foo/./bar", and standalone ".".
const PATH_PATTERN = /^([a-zA-Z0-9_][a-zA-Z0-9._-]*)(\/[a-zA-Z0-9_][a-zA-Z0-9._-]*)*$/;
export function assertSafePath(p, source = "(unknown)") {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`Unsafe path in ${source}: path must be a non-empty string`);
  }
  if (p.includes("..") || p.startsWith("/") || p.includes("\\")) {
    throw new Error(
      `Unsafe path in ${source}: ${JSON.stringify(p)} contains '..', leading '/', or '\\\\'`,
    );
  }
  if (!PATH_PATTERN.test(p)) {
    throw new Error(`Unsafe path in ${source}: ${JSON.stringify(p)} must match ${PATH_PATTERN}`);
  }
  return p;
}
