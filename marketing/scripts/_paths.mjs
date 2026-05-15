/**
 * _paths.mjs — Single source of truth for canonical file paths + small I/O
 * helpers shared across the three scripts.
 *
 * All three scripts (validate.mjs, gen-lock.mjs, hash-file.mjs) consume this
 * module so that moving or adding a top-level artifact only requires editing
 * one place. Addresses F-SCRIPTS-011.
 *
 * Paths are repo-relative (anchored at the repo root, not at marketing/).
 *
 * Roots are resolved through `resolveRoots()` so callers may override the
 * default (look one/two levels up from this script) via:
 *   - the `MCPT_MARKETING_ROOT` env var, OR
 *   - an explicit `{ root }` option (typically wired to a `--root` CLI flag).
 *
 * The `marketingRoot` / `repoRoot` exports remain for back-compat and reflect
 * the default resolution at module-load time. Scripts that honor `--root`
 * should call `resolveRoots(...)` once at startup and pass the resolved
 * `marketingRoot` / `repoRoot` through their own pipeline.
 *
 * Addresses F-SCRIPTS-B-002, F-SCRIPTS-B-013.
 */

import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, stat } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default roots (script-relative). Kept exported for back-compat; new code
// should prefer `resolveRoots()` so --root / MCPT_MARKETING_ROOT are honored.
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

// Default cap on per-file evidence reads (see F-SCRIPTS-B-009). Validate.mjs
// loads the full file into memory for hashing; without a cap, an accidentally
// committed multi-GB artifact OOMs the validator on a constrained CI runner.
// 100 MiB is generous for screenshots / PDFs / short videos and still well
// inside any reasonable runner budget. CLI: --max-evidence-bytes overrides.
export const DEFAULT_MAX_EVIDENCE_BYTES = 100 * 1024 * 1024;

/**
 * Resolve the (marketingRoot, repoRoot) pair given an optional explicit
 * override. Precedence:
 *   1. options.root (typically the --root <path> CLI flag)
 *   2. process.env.MCPT_MARKETING_ROOT
 *   3. script-relative default (one/two levels up from this file).
 *
 * The override is interpreted as a path to the marketing/ directory. `repoRoot`
 * is its parent. Both returned values are absolute filesystem paths.
 */
export function resolveRoots(options = {}) {
  const override = options.root ?? process.env.MCPT_MARKETING_ROOT ?? null;
  if (override) {
    const abs = isAbsolute(override) ? override : resolve(process.cwd(), override);
    return {
      marketingRoot: abs,
      repoRoot: dirname(abs),
    };
  }
  return { marketingRoot, repoRoot };
}

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
 * The rejection message names the SPECIFIC failure mode (path traversal vs
 * absolute path vs backslash) so the contributor knows exactly what to fix.
 * Addresses F-SCRIPTS-007 / F-SCRIPTS-W3-001 / F-SCRIPTS-B-011.
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
  // Split into specific failure modes so the contributor knows what to fix.
  // F-SCRIPTS-B-011: the bundled OR-message buried which check tripped.
  if (ref.includes("..")) {
    throw new Error(
      `Unsafe ref in ${source}: ${JSON.stringify(ref)} contains '..' (path traversal)`,
    );
  }
  if (ref.startsWith("/")) {
    throw new Error(
      `Unsafe ref in ${source}: ${JSON.stringify(ref)} is an absolute path (leading '/')`,
    );
  }
  if (ref.includes("\\")) {
    throw new Error(
      `Unsafe ref in ${source}: ${JSON.stringify(ref)} contains a backslash (Windows separator)`,
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
 * Rejection messages name the specific failure mode (F-SCRIPTS-B-011).
 * Addresses F-SCRIPTS-007 / F-SCRIPTS-W3-001 / F-SCRIPTS-B-011.
 */
// Each segment must start with [a-zA-Z0-9_-] (no leading dot). Blocks
// ".env", ".git/config", "foo/./bar", and standalone ".".
const PATH_PATTERN = /^([a-zA-Z0-9_][a-zA-Z0-9._-]*)(\/[a-zA-Z0-9_][a-zA-Z0-9._-]*)*$/;
export function assertSafePath(p, source = "(unknown)") {
  if (typeof p !== "string" || p.length === 0) {
    throw new Error(`Unsafe path in ${source}: path must be a non-empty string`);
  }
  if (p.includes("..")) {
    throw new Error(
      `Unsafe path in ${source}: ${JSON.stringify(p)} contains '..' (path traversal)`,
    );
  }
  if (p.startsWith("/")) {
    throw new Error(
      `Unsafe path in ${source}: ${JSON.stringify(p)} is an absolute path (leading '/')`,
    );
  }
  if (p.includes("\\")) {
    throw new Error(
      `Unsafe path in ${source}: ${JSON.stringify(p)} contains a backslash (Windows separator)`,
    );
  }
  if (!PATH_PATTERN.test(p)) {
    throw new Error(`Unsafe path in ${source}: ${JSON.stringify(p)} must match ${PATH_PATTERN}`);
  }
  return p;
}

/**
 * Centralized JSON loader. Moved out of validate.mjs / gen-lock.mjs so a
 * future fix (BOM strip, caching, additional guards) lands in one place.
 *
 * `absOrRel` may be an absolute filesystem path OR a path relative to
 * `anchor`. The anchor defaults to repoRoot (the script-relative default), but
 * callers that have resolved a custom root via resolveRoots() should pass it
 * explicitly.
 *
 * Errors are wrapped with `source` context so the caller's top-level error
 * envelope reports an actionable message (e.g. `Failed to read marketing
 * index (E:/.../marketing.index.json): ENOENT`). No Node stack trace.
 *
 * Addresses F-SCRIPTS-B-013.
 */
export async function loadJson(absOrRel, source, anchor = repoRoot) {
  // Use path.isAbsolute() instead of a string-prefix check: it correctly
  // identifies POSIX absolute paths AND Windows drive-letter paths AND UNC
  // paths, where a startsWith(anchor) compare would silently fail and
  // produce nonsense joined paths like "E:\AI\mcpt-marketing\D:\elsewhere\f.json".
  // Addresses F-SCRIPTS-W3-008.
  const abs = isAbsolute(absOrRel) ? absOrRel : join(anchor, absOrRel);
  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch (err) {
    throw new Error(`Failed to read ${source} (${abs}): ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${source} (${abs}) as JSON: ${err.message}`);
  }
}

/**
 * Read the package.json `version` field once. Used by the `--version` flag
 * on each script so emitted output includes a self-identifying version string
 * (currently mirrors package.json since this is a single-package repo).
 * Addresses F-SCRIPTS-B-012.
 */
let _cachedScriptVersion = null;
export async function getScriptVersion() {
  if (_cachedScriptVersion) return _cachedScriptVersion;
  // package.json is two levels up from marketing/scripts/_paths.mjs.
  // Always resolve from the script-relative default — version is a property of
  // the SCRIPT, not the marketing tree under inspection.
  const pkgPath = join(__dirname, "..", "..", "package.json");
  try {
    const pkgText = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(pkgText);
    _cachedScriptVersion = pkg.version || "unknown";
  } catch {
    _cachedScriptVersion = "unknown";
  }
  return _cachedScriptVersion;
}

/**
 * Tiny CLI argv parser shared across scripts.
 *
 * Recognizes:
 *   - `--flag` (boolean true)
 *   - `--key=value` (string value)
 *   - `--key value` (string value, where the next argv is not itself a flag)
 *   - bare positional args (collected in `_`)
 *
 * Returns `{ flags: { ... }, positional: [ ... ] }`. Unknown flags are kept
 * in `flags` so callers can decide whether to warn / fail on them.
 *
 * Intentionally avoids node:util parseArgs because we want zero-config support
 * for arbitrary keys (each script declares its own set in --help output).
 */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        // --key=value
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          // --key value (only consume if next looks like a value, not a flag)
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

// Re-export a few helpers contemporary callers need.
export { stat as fsStat };
