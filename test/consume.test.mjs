/**
 * test/consume.test.mjs — Tests for the reference consumer (FT-002).
 *
 * The consumer (examples/consume.mjs) is the executable artifact behind the
 * "Consuming MarketIR" section of README. Today the consumer recipe is prose;
 * this script makes it copy-paste-modifiable code.
 *
 * Contract surface tested here (per wave-8/feature-audit.json):
 *   - Default invocation against the live repo: exit 0, output contains the
 *     known tool ID and key fields (a quick smoke that the consumer actually
 *     loaded data, not a stub).
 *   - --json mode: stdout parses as JSON and contains a recognizable structure
 *     (tools[]/snapshot/index — exact shape is the consumer's contract, but
 *     the parse + presence-of-tool-id check is the load-bearing assertion).
 *   - Integrity check: tamper with a data file's bytes, run consume, assert
 *     the consumer complains about a hash mismatch (this is the whole point
 *     of having a lockfile).
 *   - schemaVersion warning: synthesize a lockfile with a future MAJOR and
 *     assert the consumer surfaces a warning (forward-compat signal).
 *
 * The consumer reads the lockfile + data files from a configurable root so
 * we can point it at a temp tree for the negative cases.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { makeTempMarketingTree } from "./helpers/temp-tree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONSUME_SCRIPT = join(ROOT, "examples/consume.mjs");

/**
 * Run the consumer against an arbitrary repo root. The consumer's --root flag
 * takes a path to the REPO ROOT (it expects <root>/marketing/ to exist) — it
 * intentionally does NOT depend on the producer-side _paths.mjs so the example
 * is self-contained for downstream consumers.
 */
function runConsume(repoRoot, extraArgs = []) {
  return spawnSync("node", [CONSUME_SCRIPT, "--root", repoRoot, ...extraArgs], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

describe("consume.mjs — runs against the live repo (smoke)", () => {
  it("exits 0 and surfaces the canonical tool ID in human output", () => {
    const result = spawnSync("node", [CONSUME_SCRIPT], { cwd: ROOT, encoding: "utf8" });
    assert.equal(
      result.status,
      0,
      `consume should exit 0 against the live repo; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // The output must mention the canonical tool somewhere — proves the
    // consumer actually loaded marketing data rather than printing a stub.
    assert.match(
      result.stdout + result.stderr,
      /tool\.zip-meta-map|zip-meta-map/,
      `output should reference the canonical tool; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("--json mode emits parseable JSON containing the canonical tool", () => {
    const result = spawnSync("node", [CONSUME_SCRIPT, "--json"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      0,
      `consume --json should exit 0; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (err) {
      assert.fail(
        `--json output should be parseable JSON; parse error: ${err.message}.\nstdout: ${result.stdout}`,
      );
    }
    assert.equal(typeof parsed, "object", "--json should emit a top-level object");
    assert.notEqual(parsed, null, "--json should not emit null");

    // The exact shape (tools[] vs snapshot{} vs entries{}) is the consumer's
    // contract; what we pin here is that the canonical tool ID appears
    // SOMEWHERE in the structure — a serialized scan covers any container.
    const serialized = JSON.stringify(parsed);
    assert.match(
      serialized,
      /tool\.zip-meta-map|zip-meta-map/,
      `--json output should contain the canonical tool somewhere; got: ${serialized.slice(0, 500)}`,
    );
  });
});

describe("consume.mjs — integrity check on tampered data", () => {
  const cleanup = [];
  after(() => {
    for (const dir of cleanup) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it("complains about hash mismatch when a data file is tampered with", () => {
    const { tempRoot } = makeTempMarketingTree("consume-tamper");
    cleanup.push(tempRoot);

    // Sanity: untouched temp tree should consume cleanly first.
    const baseline = runConsume(tempRoot);
    assert.equal(
      baseline.status,
      0,
      `untouched temp tree should consume cleanly; got ${baseline.status}.\nstdout: ${baseline.stdout}\nstderr: ${baseline.stderr}`,
    );

    // Tamper: append whitespace to a data file. The lockfile still has the
    // old sha256, so the consumer's integrity check must fail.
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const original = readFileSync(toolPath, "utf-8");
    writeFileSync(toolPath, original + "\n  ", "utf-8");

    const tampered = runConsume(tempRoot);
    assert.notEqual(
      tampered.status,
      0,
      `consume should fail on tampered data; got exit ${tampered.status}.\nstdout: ${tampered.stdout}\nstderr: ${tampered.stderr}`,
    );
    assert.match(
      tampered.stderr + tampered.stdout,
      /sha256|hash|integrity|mismatch|lockfile/i,
      `error should mention hash/integrity/lockfile; got stdout=${tampered.stdout} stderr=${tampered.stderr}`,
    );
  });
});

describe("consume.mjs — schemaVersion forward-compat warning", () => {
  const cleanup = [];
  after(() => {
    for (const dir of cleanup) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort
      }
    }
  });

  it("warns when the lockfile declares a future MAJOR schemaVersion", () => {
    const { tempRoot } = makeTempMarketingTree("consume-future-schema");
    cleanup.push(tempRoot);

    // Hand-edit the lockfile to declare schemaVersion: "99.0.0". The lockfile
    // hashes still match the data files (we didn't touch the data), but a
    // future MAJOR is the canonical "consumer doesn't know how to read this"
    // signal. The consumer should warn (or fail; either is acceptable per the
    // spec — what matters is the signal reaches the user).
    const lockPath = join(tempRoot, "marketing/manifests/marketing.lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf-8"));
    lock.schemaVersion = "99.0.0";
    writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");

    const result = runConsume(tempRoot);
    // Either: (a) warns and continues (exit 0 with WARN in output), or
    //         (b) fails fast (exit non-zero, error in output).
    // The load-bearing assertion is that the future-MAJOR signal is surfaced
    // — silent acceptance would be the bug.
    const combined = result.stderr + result.stdout;
    assert.match(
      combined,
      /schemaVersion|version|MAJOR|99\.0\.0|future|unsupported|incompatible/i,
      `consume should surface a schemaVersion signal for future MAJOR; got exit ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});
