import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "marketing/scripts/hash-file.mjs");

function runHash(...args) {
  return spawnSync("node", [SCRIPT, ...args], { cwd: ROOT, encoding: "utf8" });
}

describe("hash-file.mjs — known-vector + path-normalization + empty-file", () => {
  // Each test creates a temp file and registers it for cleanup. Cleanup is
  // best-effort — the OS will reap tmpdir eventually if rmSync fails.
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

  function makeTempDir(label) {
    const dir = join(tmpdir(), `mcpt-hashfile-test-${label}-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    cleanup.push(dir);
    return dir;
  }

  it("emits a known-vector sha256 for a fixture file with deterministic bytes", () => {
    // sha256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    const dir = makeTempDir("known-vector");
    const filePath = join(dir, "fixture.txt");
    writeFileSync(filePath, "hello world", "utf-8");

    const result = runHash(filePath);
    assert.equal(
      result.status,
      0,
      `hash-file should exit 0 on a readable file; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    const out = JSON.parse(result.stdout);
    assert.equal(
      out.sha256,
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
      `known-vector sha256 mismatch for "hello world"; got ${out.sha256}`,
    );
    assert.equal(out.bytes, 11, `expected 11 bytes for "hello world"; got ${out.bytes}`);
  });

  it("emits sha256 e3b0c4...b855 for an empty file (canonical empty-bytes hash)", () => {
    const dir = makeTempDir("empty");
    const filePath = join(dir, "empty.bin");
    writeFileSync(filePath, "", "utf-8");

    const result = runHash(filePath);
    assert.equal(
      result.status,
      0,
      `hash-file should exit 0 on an empty file; got ${result.status}.\nstderr: ${result.stderr}`,
    );
    const out = JSON.parse(result.stdout);
    assert.equal(
      out.sha256,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      `empty-file sha256 mismatch; got ${out.sha256}`,
    );
    assert.equal(out.bytes, 0, `expected 0 bytes; got ${out.bytes}`);
  });

  it("normalizes Windows backslashes to POSIX forward slashes in the emitted path", () => {
    // Create a nested file so the relative path actually contains a separator.
    const dir = makeTempDir("posix-norm");
    const subdir = join(dir, "sub");
    mkdirSync(subdir, { recursive: true });
    const filePath = join(subdir, "f.txt");
    writeFileSync(filePath, "x", "utf-8");

    // Build a path with explicit backslashes regardless of platform — this is
    // the surface the F-SCRIPTS-010 fix protects. The normalization must run
    // even on POSIX so the test is meaningful cross-platform.
    const backslashPath = filePath.replace(/[/\\]/g, "\\");
    const result = runHash(backslashPath);
    assert.equal(
      result.status,
      0,
      `hash-file should exit 0; got ${result.status}.\nstderr: ${result.stderr}`,
    );
    const out = JSON.parse(result.stdout);
    assert.ok(
      !out.path.includes("\\"),
      `emitted path must not contain backslashes (POSIX-normalized); got ${JSON.stringify(out.path)}`,
    );
    assert.ok(
      out.path.includes("/"),
      `emitted path should use forward slashes for nested files; got ${JSON.stringify(out.path)}`,
    );
  });

  it("exits non-zero with a usage message when called with no argument", () => {
    const result = runHash();
    assert.equal(
      result.status,
      1,
      `hash-file should exit 1 when no arg is given; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /Usage:/i,
      `stderr should contain a usage message; got: ${result.stderr}`,
    );
  });
});
