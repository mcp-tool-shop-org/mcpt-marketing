/**
 * test/helpers/temp-tree.mjs — Shared test fixtures.
 *
 * Extracted from validate.test.mjs (F-W6-TESTS-004) so any test that needs to
 * mutate the marketing/ tree in isolation can do so in 1-2 lines:
 *
 *   const { tempRoot, validateScript, marketingDir } = makeTempMarketingTree("my-test");
 *   cleanup.push(tempRoot);
 *   mutateTool(tempRoot, "tools/zip-meta-map.json", (tool) => {
 *     tool.claims[0].id = "duplicate";
 *   });
 *
 * Why a shared helper:
 *   - validate.mjs is anchored to its own __dirname, so to run it against a
 *     mutated tree we copy everything (scripts + schema + data + manifests)
 *     into a temp dir and invoke the temp copy. Inlining this 25-line setup
 *     into every negative test invites copy-paste drift.
 *   - The mutator API includes a fixture-shape sanity assertion so a tool-
 *     refactor (e.g. renaming `messages[0].constraints.maxChars`) produces a
 *     single legible failure rather than `cannot read property of undefined`
 *     across every test that touched that path.
 */

import { readFileSync, writeFileSync, mkdirSync, cpSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/helpers/temp-tree.mjs -> repo root  (two levels up)
const ROOT = join(__dirname, "..", "..");

/**
 * Build an isolated marketing/ tree under tmpdir by copying the real
 * marketing/ contents. node_modules is symlinked when possible (cheap) and
 * copied as a fallback (cross-platform reliability).
 *
 * @param {string} label — short tag used in the temp dir name; must be safe
 *                         to embed in a filesystem path.
 * @returns {{ tempRoot: string, validateScript: string, marketingDir: string,
 *             repoRoot: string }}
 *   - tempRoot: absolute path to the temp tree's repo root
 *   - validateScript: absolute path to the temp copy of validate.mjs
 *   - marketingDir: absolute path to the temp copy of marketing/
 *   - repoRoot: alias for tempRoot (for symmetry with the live repo)
 *
 * Caller is responsible for cleanup via rmSync(tempRoot, { recursive: true,
 * force: true }) — typically done in an after() hook with a cleanup[] array.
 */
export function makeTempMarketingTree(label) {
  const tempRoot = join(tmpdir(), `mcpt-marketing-test-${label}-${process.pid}-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });
  // Mirror only the marketing/ subtree — that's all validate.mjs reads.
  cpSync(join(ROOT, "marketing"), join(tempRoot, "marketing"), {
    recursive: true,
  });
  // Mirror node_modules so ajv resolves. Try symlink first (junction works on
  // Windows without admin rights and on POSIX as a regular symlink); fall back
  // to a full copy where symlinks are denied.
  ensureNodeModules(tempRoot);
  return {
    tempRoot,
    repoRoot: tempRoot,
    validateScript: join(tempRoot, "marketing/scripts/validate.mjs"),
    marketingDir: join(tempRoot, "marketing"),
  };
}

/**
 * Symlink-or-copy helper for node_modules — separated out so other helpers
 * (or future test suites) can reuse it.
 *
 * @param {string} tempRoot — absolute path that should contain node_modules.
 */
export function ensureNodeModules(tempRoot) {
  try {
    symlinkSync(join(ROOT, "node_modules"), join(tempRoot, "node_modules"), "junction");
  } catch {
    // Fall back to copy on platforms / filesystems where symlink is denied.
    cpSync(join(ROOT, "node_modules"), join(tempRoot, "node_modules"), {
      recursive: true,
    });
  }
}

/**
 * Load a tool/audience/campaign JSON file from the temp tree, apply a mutator,
 * and write the result back. Includes a fixture-shape assertion so a refactor
 * that drops a load-bearing field surfaces as a single legible failure.
 *
 * @param {string} tempRoot — absolute path to the temp tree's repo root.
 * @param {string} dataRef  — repo-relative ref like "tools/zip-meta-map.json"
 *                            or "audiences/ci-maintainers.json".
 * @param {(obj: any) => void} mutator — receives the parsed object; mutate in
 *                            place. Return value ignored.
 * @returns {any} the mutated object (already written to disk).
 */
export function mutateData(tempRoot, dataRef, mutator) {
  const filePath = join(tempRoot, "marketing/data", dataRef);
  const obj = JSON.parse(readFileSync(filePath, "utf-8"));
  mutator(obj);
  writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
  return obj;
}

/**
 * Convenience wrapper for the most common case: mutating the canonical tool
 * fixture (zip-meta-map.json). Equivalent to:
 *   mutateData(tempRoot, "tools/zip-meta-map.json", mutator)
 */
export function mutateTool(tempRoot, mutator) {
  return mutateData(tempRoot, "tools/zip-meta-map.json", mutator);
}

/**
 * Load and rewrite an arbitrary file inside the temp tree's marketing/
 * subtree (e.g. the index, the evidence manifest, the schema). The mutator
 * receives the parsed JSON; for non-JSON files use writeFileSync directly.
 *
 * @param {string} tempRoot — absolute path to the temp tree's repo root.
 * @param {string} relPath — repo-relative path under marketing/ like
 *                          "data/marketing.index.json" or
 *                          "manifests/evidence.manifest.json".
 * @param {(obj: any) => void} mutator
 */
export function mutateMarketingFile(tempRoot, relPath, mutator) {
  const filePath = join(tempRoot, "marketing", relPath);
  const obj = JSON.parse(readFileSync(filePath, "utf-8"));
  mutator(obj);
  writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf-8");
  return obj;
}
