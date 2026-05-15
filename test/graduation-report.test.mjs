/**
 * test/graduation-report.test.mjs — Tests for the graduation-report script (FT-005).
 *
 * The graduation report aggregates aspirational claims that are past their
 * `graduation.targetDate`, grouped by `graduation.blockedBy` + `owner`. Today
 * the schema added these fields but nothing reads them — this script makes
 * "aspirational means aspirational" enforceable.
 *
 * Contract surface tested here (per wave-8/feature-audit.json):
 *   - Default invocation against the live repo: runs without crashing; exit
 *     code reflects whether any claim is overdue. Today's fixture has target
 *     dates well in the future (2026-09-15 .. 2026-11-01) so a fresh-clone
 *     consumer should currently get exit 0.
 *   - --json mode: parseable JSON containing a recognizable structure.
 *   - All-on-track fixture: exit 0.
 *   - One-overdue fixture (set targetDate to past): exit 1.
 *   - Untracked fixture (aspirational claim with no graduation block): the
 *     report still surfaces it as a separate untracked-claim signal.
 *
 * Each negative test owns its own temp tree so mutations isolate.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempMarketingTree } from "./helpers/temp-tree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const GRAD_SCRIPT = join(ROOT, "marketing/scripts/graduation-report.mjs");

function runGraduation(rootPath, extraArgs = []) {
  return spawnSync("node", [GRAD_SCRIPT, "--root", join(rootPath, "marketing"), ...extraArgs], {
    cwd: rootPath,
    encoding: "utf8",
  });
}

describe("graduation-report.mjs — runs against live repo", () => {
  it("runs without crashing against the real on-disk tree", () => {
    const result = spawnSync("node", [GRAD_SCRIPT], { cwd: ROOT, encoding: "utf8" });
    // Exit code reflects whether any claim is overdue. The current fixture's
    // earliest targetDate is 2026-09-15 — assuming "now" is before that, exit
    // should be 0. If a future test run lands after that date, exit 1 is the
    // correct signal. Either way the script must not crash.
    assert.ok(
      result.status === 0 || result.status === 1,
      `graduation-report should exit 0 or 1 (not crash); got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // Defense-in-depth: no Node stack trace in either path.
    assert.ok(
      !/\n\s+at\s/.test(result.stderr),
      `stderr should not contain a Node stack trace; got: ${result.stderr}`,
    );
  });

  it("--json mode emits parseable JSON with a recognizable structure", () => {
    const result = spawnSync("node", [GRAD_SCRIPT, "--json"], { cwd: ROOT, encoding: "utf8" });
    assert.ok(
      result.status === 0 || result.status === 1,
      `graduation-report --json should exit 0 or 1; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
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
  });
});

describe("graduation-report.mjs — date-driven exit codes", () => {
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

  it("exits 0 when ALL aspirational claims have future target dates", () => {
    const { tempRoot } = makeTempMarketingTree("grad-all-on-track");
    cleanup.push(tempRoot);

    // Push every claim's targetDate well into the future. Pick a date
    // arbitrarily far ahead so the test is robust to clock drift.
    const FAR_FUTURE = "2099-12-31";
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    for (const claim of tool.claims) {
      if (claim.status === "aspirational") {
        claim.graduation = {
          ...(claim.graduation || {}),
          targetDate: FAR_FUTURE,
          blockedBy: claim.graduation?.blockedBy || "test-fixture",
          owner: claim.graduation?.owner || "mcp-tool-shop",
          criteria: claim.graduation?.criteria || "test-fixture criteria",
        };
      }
    }
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runGraduation(tempRoot);
    assert.equal(
      result.status,
      0,
      `graduation-report should exit 0 when nothing is overdue; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });

  it("exits 1 when at least one aspirational claim is past its targetDate", () => {
    const { tempRoot } = makeTempMarketingTree("grad-one-overdue");
    cleanup.push(tempRoot);

    // Set the first aspirational claim's targetDate to a past date. Push the
    // others to the far future so the only overdue one is the one we mutated.
    const PAST = "2020-01-01";
    const FAR_FUTURE = "2099-12-31";
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    let mutated = false;
    for (const claim of tool.claims) {
      if (claim.status !== "aspirational") continue;
      if (!mutated) {
        claim.graduation = {
          ...(claim.graduation || {}),
          targetDate: PAST,
          blockedBy: claim.graduation?.blockedBy || "test-fixture",
          owner: claim.graduation?.owner || "mcp-tool-shop",
          criteria: claim.graduation?.criteria || "test-fixture criteria",
        };
        mutated = true;
      } else {
        claim.graduation = {
          ...(claim.graduation || {}),
          targetDate: FAR_FUTURE,
          blockedBy: claim.graduation?.blockedBy || "test-fixture",
          owner: claim.graduation?.owner || "mcp-tool-shop",
          criteria: claim.graduation?.criteria || "test-fixture criteria",
        };
      }
    }
    assert.ok(mutated, "fixture must have >=1 aspirational claim");
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runGraduation(tempRoot);
    assert.equal(
      result.status,
      1,
      `graduation-report should exit 1 when a claim is overdue; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // The output should mention the overdue claim ID.
    assert.match(
      result.stdout + result.stderr,
      /overdue|claim|past|target/i,
      `output should mention the overdue claim; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("--json mode in the overdue case includes the past-date claim", () => {
    const { tempRoot } = makeTempMarketingTree("grad-overdue-json");
    cleanup.push(tempRoot);

    const PAST = "2020-01-01";
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    const target = tool.claims.find((c) => c.status === "aspirational");
    assert.ok(target, "fixture must have >=1 aspirational claim");
    target.graduation = {
      ...(target.graduation || {}),
      targetDate: PAST,
      blockedBy: target.graduation?.blockedBy || "test-fixture",
      owner: target.graduation?.owner || "mcp-tool-shop",
      criteria: target.graduation?.criteria || "test-fixture criteria",
    };
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runGraduation(tempRoot, ["--json"]);
    assert.equal(
      result.status,
      1,
      `--json + overdue should exit 1; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (err) {
      assert.fail(
        `--json output should be parseable JSON; parse error: ${err.message}.\nstdout: ${result.stdout}`,
      );
    }
    // The overdue claim ID should appear somewhere in the structure.
    const serialized = JSON.stringify(parsed);
    assert.match(
      serialized,
      new RegExp(target.id.replace(/[.+]/g, "\\$&")),
      `--json output should include the overdue claim ${target.id}; got: ${serialized.slice(0, 800)}`,
    );
  });
});

describe("graduation-report.mjs — untracked aspirational claims", () => {
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

  it("surfaces aspirational claims with no graduation block (untracked)", () => {
    const { tempRoot } = makeTempMarketingTree("grad-untracked");
    cleanup.push(tempRoot);

    // Strip the graduation block from the first aspirational claim so it has
    // status: aspirational but no targetDate. The schema permits this
    // (graduation is optional on aspirational claims) — the report's job is
    // to flag it as dark inventory.
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    const target = tool.claims.find((c) => c.status === "aspirational");
    assert.ok(target, "fixture must have >=1 aspirational claim");
    delete target.graduation;
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runGraduation(tempRoot, ["--json"]);
    // Exit code may be 0 or 1 depending on whether the report treats
    // untracked as a soft signal. What we pin: the claim ID appears in the
    // JSON output so a downstream consumer (or human reader) can see it.
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (err) {
      assert.fail(
        `--json output should be parseable JSON; parse error: ${err.message}.\nstdout: ${result.stdout}`,
      );
    }
    const serialized = JSON.stringify(parsed);
    assert.match(
      serialized,
      new RegExp(target.id.replace(/[.+]/g, "\\$&")),
      `--json output should include the untracked claim ${target.id}; got: ${serialized.slice(0, 800)}`,
    );
  });
});
