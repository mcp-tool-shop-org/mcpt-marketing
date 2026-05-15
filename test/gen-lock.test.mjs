import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function hash(buf) {
  return createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "marketing/scripts/gen-lock.mjs");
const LOCK = join(ROOT, "marketing/manifests/marketing.lock.json");
const BACKUP = join(ROOT, "marketing/manifests/marketing.lock.json.bak");

function runGenLock(args = []) {
  return spawnSync("node", [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

describe("gen-lock.mjs determinism + check mode", () => {
  // Snapshot the on-disk lockfile so any regeneration done in this suite is
  // reverted at the end. Other tests (and CI's `npm run lock:check`) depend on
  // it. The gen-lock script itself is what's under test, not the on-disk file.
  before(() => {
    if (existsSync(LOCK)) copyFileSync(LOCK, BACKUP);
  });
  after(() => {
    if (existsSync(BACKUP)) {
      copyFileSync(BACKUP, LOCK);
      try {
        unlinkSync(BACKUP);
      } catch {
        // best effort — leaving the backup behind is harmless.
      }
    }
  });

  it("regenerates byte-identical lockfile twice in a row (determinism roundtrip)", () => {
    // F-TESTS-003 + F-TESTS-012 — the load-bearing test for the repo's
    // headline "deterministic" claim. Same inputs => byte-identical lockfile.
    const first = runGenLock();
    assert.equal(first.status, 0, `first run failed: ${first.stderr}`);
    assert.ok(existsSync(LOCK), "lockfile was not written by first run");
    const firstBytes = readFileSync(LOCK);

    const second = runGenLock();
    assert.equal(second.status, 0, `second run failed: ${second.stderr}`);
    const secondBytes = readFileSync(LOCK);

    assert.ok(
      firstBytes.equals(secondBytes),
      "Lockfile bytes differ between two consecutive runs — determinism contract violated.\n" +
        `first  bytes=${firstBytes.length} sha=${hash(firstBytes)}\n` +
        `second bytes=${secondBytes.length} sha=${hash(secondBytes)}`,
    );
  });

  it("--check accepts current state (exit 0) immediately after lock", () => {
    // Pre-condition: lockfile must reflect current data. Regenerate so this
    // test isn't coupled to whatever the on-disk lockfile looked like at
    // session start.
    const gen = runGenLock();
    assert.equal(gen.status, 0, `gen-lock failed: ${gen.stderr}`);

    const check = runGenLock(["--check"]);
    assert.equal(
      check.status,
      0,
      `--check should exit 0 after a fresh lock, got ${check.status}.\nstdout: ${check.stdout}\nstderr: ${check.stderr}`,
    );
    assert.match(
      check.stdout,
      /up to date/i,
      `--check stdout should mention 'up to date'; got: ${check.stdout}`,
    );
  });

  it("--check detects drift when a sha256 is tampered (exit 1, restorable)", () => {
    // Regenerate to a known-good state.
    const gen = runGenLock();
    assert.equal(gen.status, 0, `gen-lock failed: ${gen.stderr}`);

    const original = readFileSync(LOCK, "utf8");

    // Tamper: flip one hex char of the first sha256. Use a regex on the JSON
    // text rather than parse/serialize so we can corrupt the on-disk bytes
    // without depending on the lockfile's key ordering.
    const tampered = original.replace(/"sha256":\s*"([0-9a-f])([0-9a-f]{63})"/, (_m, c, rest) => {
      const flipped = c === "0" ? "1" : "0";
      return `"sha256": "${flipped}${rest}"`;
    });
    assert.notEqual(tampered, original, "tamper regex did not match any sha256 entry");
    writeFileSync(LOCK, tampered, "utf8");

    try {
      const check = runGenLock(["--check"]);
      assert.equal(
        check.status,
        1,
        `--check should exit 1 on drift, got ${check.status}.\nstdout: ${check.stdout}\nstderr: ${check.stderr}`,
      );
      // stderr should mention drift / out of date — give it some flexibility.
      assert.match(
        check.stderr,
        /out of date|drift|differ/i,
        `--check stderr should mention drift; got: ${check.stderr}`,
      );
    } finally {
      // Restore so subsequent tests / CI see a clean tree.
      writeFileSync(LOCK, original, "utf8");
    }
  });

  it("--check detects drift when an entry is removed (exit 1, restorable)", () => {
    const gen = runGenLock();
    assert.equal(gen.status, 0, `gen-lock failed: ${gen.stderr}`);

    const original = readFileSync(LOCK, "utf8");
    const parsed = JSON.parse(original);
    assert.ok(
      Array.isArray(parsed.files) && parsed.files.length > 1,
      "lockfile must have >1 file entries for the removal test",
    );

    // Drop the last entry, write back, expect --check to flag the missing
    // file.
    const dropped = parsed.files.pop();
    writeFileSync(LOCK, JSON.stringify(parsed, null, 2) + "\n", "utf8");

    try {
      const check = runGenLock(["--check"]);
      assert.equal(
        check.status,
        1,
        `--check should exit 1 when an entry is removed (was: ${dropped.path}); got ${check.status}`,
      );
    } finally {
      writeFileSync(LOCK, original, "utf8");
    }
  });

  it("regenerated lockfile contains no 'generatedAt' field (determinism contract)", () => {
    // F-SCRIPTS-002 cross-check: the lockfile precedent (npm, cargo) excludes
    // wall-clock timestamps because they break determinism.
    const gen = runGenLock();
    assert.equal(gen.status, 0, `gen-lock failed: ${gen.stderr}`);
    const lock = JSON.parse(readFileSync(LOCK, "utf8"));
    assert.ok(
      !("generatedAt" in lock),
      `lockfile must NOT contain 'generatedAt' (would make it non-deterministic). Found: ${lock.generatedAt}`,
    );
  });

  it("lockfile keys are sorted alphabetically at the top level", () => {
    // F-SCRIPTS-003 cross-check: the sortKeysReplacer in gen-lock.mjs should
    // emit keys in alpha order regardless of object literal order in source.
    const gen = runGenLock();
    assert.equal(gen.status, 0, `gen-lock failed: ${gen.stderr}`);
    const text = readFileSync(LOCK, "utf8");
    const keysInOrder = [...text.matchAll(/^\s{2}"([^"]+)":/gm)].map((m) => m[1]);
    const sorted = [...keysInOrder].sort();
    assert.deepEqual(
      keysInOrder,
      sorted,
      `top-level keys are not alphabetically sorted.\nactual: ${JSON.stringify(keysInOrder)}\nsorted: ${JSON.stringify(sorted)}`,
    );
  });

  it("file-entry array is sorted by path (determinism guard)", () => {
    const gen = runGenLock();
    assert.equal(gen.status, 0, `gen-lock failed: ${gen.stderr}`);
    const lock = JSON.parse(readFileSync(LOCK, "utf8"));
    const paths = lock.files.map((f) => f.path);
    const sorted = [...paths].sort();
    assert.deepEqual(
      paths,
      sorted,
      `lockfile.files[].path is not sorted alphabetically.\nactual: ${JSON.stringify(paths)}\nsorted: ${JSON.stringify(sorted)}`,
    );
  });

  // F-W6-TESTS-002 — first-clone error path.
  // gen-lock.mjs:110-116 wraps a missing-lockfile ENOENT into a helpful
  // "Run 'npm run lock'" envelope. This is the message a contributor sees on
  // a fresh clone if they run `npm run lock:check` before `npm run lock`. A
  // regression that drops the wrapper (e.g. propagates the raw ENOENT) would
  // not fail any existing test because the rest of the suite always
  // regenerates the lockfile in `before()`.
  it("--check exits 1 with a helpful message when the lockfile is missing", () => {
    // The `before()` hook above already snapshotted LOCK -> BACKUP; the
    // `after()` hook restores it. So we can safely delete the on-disk lock
    // here knowing the suite will leave a clean tree behind.
    if (existsSync(LOCK)) unlinkSync(LOCK);
    assert.ok(!existsSync(LOCK), "precondition: lockfile must be absent for this test");

    try {
      const check = runGenLock(["--check"]);
      assert.equal(
        check.status,
        1,
        `--check should exit 1 when lockfile is missing; got ${check.status}.\nstdout: ${check.stdout}\nstderr: ${check.stderr}`,
      );
      assert.match(
        check.stderr,
        /Lockfile does not exist|Run.*npm run lock/i,
        `stderr should explain the missing lockfile and how to fix it; got: ${check.stderr}`,
      );
      // Defense-in-depth: the message should be a one-line envelope, not a
      // raw Node ENOENT stack.
      assert.ok(
        !/\n\s+at\s/.test(check.stderr),
        `stderr should not contain a Node stack trace; got: ${check.stderr}`,
      );
    } finally {
      // Restore from BACKUP so subsequent tests in this suite (and the
      // `after()` hook) see a clean tree. Without this, the next test that
      // expects an existing lockfile would race against the regen.
      if (existsSync(BACKUP)) copyFileSync(BACKUP, LOCK);
    }
  });

  it("--check exits 1 with a clean envelope when the lockfile is not valid JSON", () => {
    // Companion to the missing-lockfile test: gen-lock.mjs:120-124 wraps a
    // JSON.parse failure into a "Lockfile at X is not valid JSON" envelope.
    // Pin so a refactor that drops the try/catch surfaces a raw SyntaxError.
    writeFileSync(LOCK, "{not json", "utf8");

    try {
      const check = runGenLock(["--check"]);
      assert.equal(
        check.status,
        1,
        `--check should exit 1 on malformed lockfile; got ${check.status}.\nstdout: ${check.stdout}\nstderr: ${check.stderr}`,
      );
      assert.match(
        check.stderr,
        /not valid JSON|JSON/i,
        `stderr should mention 'not valid JSON'; got: ${check.stderr}`,
      );
    } finally {
      if (existsSync(BACKUP)) copyFileSync(BACKUP, LOCK);
    }
  });
});
