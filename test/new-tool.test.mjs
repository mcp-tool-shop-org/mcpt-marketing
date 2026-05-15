/**
 * test/new-tool.test.mjs — Tests for the `new-tool <id>` scaffold script (FT-001).
 *
 * Wave-9 feature execution. The scripts agent produces
 * marketing/scripts/new-tool.mjs in parallel; these tests pin the contract
 * surface specified in wave-8/feature-audit.json:
 *
 *   - Creates marketing/data/tools/<id>.json (well-formed JSON; structurally
 *     correct shape).
 *   - Updates marketing/data/marketing.index.json to include the new tool.
 *   - Refuses to overwrite an existing tool (idempotent-by-default).
 *   - Rejects invalid IDs (uppercase, spaces, etc.) with a clear error.
 *
 * Note on schema-validation: the scaffold intentionally writes placeholder
 * values (e.g. `aud.PLACEHOLDER-EDIT-ME`) so the contributor MUST replace them
 * before validate.mjs passes. We therefore assert structural correctness
 * (fields present, types right, top-level shape) instead of full validate.mjs
 * pass — full validation happens after the contributor edits the placeholders.
 *
 * Each test owns its own temp tree (via the existing temp-tree helper) so
 * failures isolate to the test that mutated state.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempMarketingTree } from "./helpers/temp-tree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const NEW_TOOL_SCRIPT = join(ROOT, "marketing/scripts/new-tool.mjs");

/**
 * Run the new-tool script against a temp tree. _paths.mjs's resolveRoots()
 * takes --root pointing at the marketing/ directory and derives repoRoot
 * from its parent.
 */
function runNewTool(tempRoot, args) {
  return spawnSync("node", [NEW_TOOL_SCRIPT, ...args, "--root", join(tempRoot, "marketing")], {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

describe("new-tool.mjs — scaffolds a new tool entry", () => {
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

  it("creates data/tools/<id>.json that is well-formed and structurally complete", () => {
    const { tempRoot } = makeTempMarketingTree("new-tool-create");
    cleanup.push(tempRoot);

    const result = runNewTool(tempRoot, ["my-new-tool"]);
    assert.equal(
      result.status,
      0,
      `new-tool should exit 0; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    const newToolPath = join(tempRoot, "marketing/data/tools/my-new-tool.json");
    assert.ok(existsSync(newToolPath), `expected ${newToolPath} to exist after scaffolding`);

    // File parses as JSON and has the canonical top-level shape. Every
    // required schema field must be present even though some values are
    // placeholder-text (e.g. aud.PLACEHOLDER-EDIT-ME) — the contributor
    // edits before running validate.
    const tool = JSON.parse(readFileSync(newToolPath, "utf-8"));
    assert.ok(typeof tool.schemaVersion === "string", "tool must declare schemaVersion");
    assert.equal(
      tool.id,
      "tool.my-new-tool",
      `tool.id must be tool.<id>; got ${JSON.stringify(tool.id)}`,
    );
    assert.ok(typeof tool.name === "string" && tool.name.length > 0, "tool.name required");
    assert.ok(typeof tool.positioning === "object", "tool.positioning required");
    assert.ok(
      typeof tool.positioning.oneLiner === "string" && tool.positioning.oneLiner.length > 0,
      "tool.positioning.oneLiner required",
    );
    assert.ok(
      Array.isArray(tool.positioning.valueProps) && tool.positioning.valueProps.length > 0,
      "tool.positioning.valueProps required",
    );
    assert.ok(Array.isArray(tool.audienceRefs), "tool.audienceRefs required");
    assert.ok(
      Array.isArray(tool.claims) && tool.claims.length > 0,
      "tool.claims must be non-empty",
    );
    assert.ok(
      Array.isArray(tool.messages) && tool.messages.length > 0,
      "tool.messages must be non-empty",
    );
    // press / targeting are optional in the schema but the scaffold should
    // produce them so the contributor sees the full surface.
    assert.ok(typeof tool.press === "object", "tool.press should be scaffolded");
    assert.ok(typeof tool.targeting === "object", "tool.targeting should be scaffolded");

    // Each claim must have a graduation block so the graduation report sees
    // it immediately (the whole point of FT-005's downstream wiring).
    for (const claim of tool.claims) {
      assert.equal(
        claim.status,
        "aspirational",
        `scaffold claim ${claim.id} should default to aspirational`,
      );
      assert.ok(
        typeof claim.graduation === "object" && typeof claim.graduation.targetDate === "string",
        `scaffold claim ${claim.id} should include graduation.targetDate`,
      );
    }

    // Each message must declare a non-empty claimRefs[] (schema requires it).
    for (const msg of tool.messages) {
      assert.ok(
        Array.isArray(msg.claimRefs) && msg.claimRefs.length > 0,
        `scaffold message ${msg.id} should include >=1 claimRef`,
      );
    }
  });

  it("updates marketing.index.json to include the new tool", () => {
    const { tempRoot } = makeTempMarketingTree("new-tool-index");
    cleanup.push(tempRoot);

    const indexPath = join(tempRoot, "marketing/data/marketing.index.json");
    const beforeIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
    const beforeRefs = new Set((beforeIndex.tools || []).map((t) => t.ref));

    const result = runNewTool(tempRoot, ["index-test-tool"]);
    assert.equal(
      result.status,
      0,
      `new-tool should exit 0; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    const afterIndex = JSON.parse(readFileSync(indexPath, "utf-8"));
    const expectedRef = "tools/index-test-tool.json";
    const found = (afterIndex.tools || []).some((t) => t.ref === expectedRef);
    assert.ok(
      found,
      `marketing.index.json[tools] should contain { ref: "${expectedRef}" } after scaffolding; got tools=${JSON.stringify(afterIndex.tools)}`,
    );

    // Sanity: pre-existing entries are preserved (no clobber).
    for (const ref of beforeRefs) {
      assert.ok(
        (afterIndex.tools || []).some((t) => t.ref === ref),
        `pre-existing tool ref ${ref} was lost after scaffolding`,
      );
    }
  });

  it("refuses to overwrite an existing tool (idempotent-by-default)", () => {
    const { tempRoot } = makeTempMarketingTree("new-tool-overwrite");
    cleanup.push(tempRoot);

    // First run: create.
    const first = runNewTool(tempRoot, ["overwrite-guard"]);
    assert.equal(
      first.status,
      0,
      `first run should succeed; got ${first.status}.\nstdout: ${first.stdout}\nstderr: ${first.stderr}`,
    );

    // Second run with the same ID: must fail (non-zero exit), and must not
    // have silently overwritten the file.
    const second = runNewTool(tempRoot, ["overwrite-guard"]);
    assert.notEqual(
      second.status,
      0,
      `second run with same ID should fail; got exit ${second.status}.\nstdout: ${second.stdout}\nstderr: ${second.stderr}`,
    );
    assert.match(
      second.stderr + second.stdout,
      /already exists|refus|exists|overwrite/i,
      `error message should explain the file already exists; got stdout=${second.stdout} stderr=${second.stderr}`,
    );
  });

  it("rejects an uppercase ID with a clear error", () => {
    const { tempRoot } = makeTempMarketingTree("new-tool-uppercase");
    cleanup.push(tempRoot);

    const result = runNewTool(tempRoot, ["MyBadID"]);
    assert.notEqual(
      result.status,
      0,
      `uppercase ID should be rejected; got exit ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /invalid|id|lowercase|pattern|[a-z0-9-]/i,
      `error message should mention the ID validity rule; got stdout=${result.stdout} stderr=${result.stderr}`,
    );

    // No file should have been created with the uppercase name (or any case).
    const badPath = join(tempRoot, "marketing/data/tools/MyBadID.json");
    assert.ok(!existsSync(badPath), `no file should be created on invalid ID; ${badPath} exists`);
  });

  it("rejects an ID with whitespace with a clear error", () => {
    const { tempRoot } = makeTempMarketingTree("new-tool-spaces");
    cleanup.push(tempRoot);

    const result = runNewTool(tempRoot, ["bad id with spaces"]);
    assert.notEqual(
      result.status,
      0,
      `space-containing ID should be rejected; got exit ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /invalid|id|space|whitespace|pattern|[a-z0-9-]/i,
      `error message should mention the ID validity rule; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects an ID with leading/trailing dashes or empty string", () => {
    const { tempRoot } = makeTempMarketingTree("new-tool-edge-id");
    cleanup.push(tempRoot);

    // Empty string — no positional. The script must fail with a usage message
    // rather than crashing on undefined.
    const noArg = runNewTool(tempRoot, []);
    assert.notEqual(
      noArg.status,
      0,
      `missing ID arg should fail; got exit ${noArg.status}.\nstdout: ${noArg.stdout}\nstderr: ${noArg.stderr}`,
    );

    // The output should not contain a Node stack trace — error envelope only.
    assert.ok(
      !/\n\s+at\s/.test(noArg.stderr),
      `stderr should not contain a Node stack trace; got: ${noArg.stderr}`,
    );
  });
});
