import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, symlinkSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "marketing/scripts/validate.mjs");
const TOOL_FIXTURE_PATH = join(ROOT, "marketing/data/tools/zip-meta-map.json");

/**
 * Build an isolated marketing/ tree under a temp dir by copying the real
 * marketing/ contents. validate.mjs is anchored to its own __dirname, so to
 * run it against a mutated tree we copy everything (scripts + schema + data
 * + manifests) into the temp dir and invoke the temp copy of validate.mjs.
 *
 * Returns { tempRoot, validateScript } — caller is responsible for cleanup
 * via rmSync(tempRoot, { recursive: true, force: true }).
 */
function makeTempMarketingTree(label) {
  const tempRoot = join(tmpdir(), `mcpt-marketing-test-${label}-${process.pid}-${Date.now()}`);
  mkdirSync(tempRoot, { recursive: true });
  // Mirror only the marketing/ subtree — that's all validate.mjs reads.
  cpSync(join(ROOT, "marketing"), join(tempRoot, "marketing"), {
    recursive: true,
  });
  // Mirror node_modules so ajv resolves. Symlink would be faster but we want
  // cross-platform reliability — node has built-in handling for repeated
  // copies, and the tests run rarely enough that cost is fine.
  // Cheaper alternative: symlink + fall back to copy. Try symlink first
  // (junction works on Windows without admin rights and on POSIX as a regular
  // symlink because node ignores the type arg there).
  try {
    symlinkSync(join(ROOT, "node_modules"), join(tempRoot, "node_modules"), "junction");
  } catch {
    // Fall back to copy on platforms / filesystems where symlink is denied.
    cpSync(join(ROOT, "node_modules"), join(tempRoot, "node_modules"), {
      recursive: true,
    });
  }
  return {
    tempRoot,
    validateScript: join(tempRoot, "marketing/scripts/validate.mjs"),
  };
}

function runValidate(scriptPath, cwd) {
  return spawnSync("node", [scriptPath], { cwd, encoding: "utf8" });
}

describe("validate.mjs — current state passes", () => {
  it("validates the real on-disk marketing/ tree (smoke)", () => {
    const result = spawnSync("node", [SCRIPT], { cwd: ROOT, encoding: "utf8" });
    assert.equal(
      result.status,
      0,
      `validate.mjs against the real tree should exit 0; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stdout,
      /All validations passed/,
      `stdout should report success; got: ${result.stdout}`,
    );
  });
});

describe("validate.mjs — rejects broken data (negative cases)", () => {
  // Each test owns its own temp tree so they can mutate independently.
  const cleanup = [];
  after(() => {
    for (const dir of cleanup) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best effort — the OS will clean tmpdir eventually.
      }
    }
  });

  it("rejects a tool with a duplicated claim ID (exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("dup-id");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Duplicate the first claim id by reusing it on the second claim.
    assert.ok(tool.claims.length >= 2, "fixture must have >=2 claims");
    tool.claims[1].id = tool.claims[0].id;
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on duplicate ID; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /[Dd]uplicate/,
      `output should mention duplicate; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects a message with a dangling claimRef (exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("dangling-claim");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    assert.ok(tool.messages.length >= 1, "fixture must have >=1 message");
    // Replace the first claimRef on the first message with one that does not
    // exist in this tool's claims.
    tool.messages[0].claimRefs = ["claim.zip-meta-map.does-not-exist"];
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on dangling claimRef; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /references claim .* (which is not in|does not exist)|claim\.zip-meta-map\.does-not-exist/,
      `output should mention the bad claim reference; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects a proven claim that is missing evidenceRefs (exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("proven-no-ev");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Promote the first claim to "proven" and strip its evidenceRefs. This is
    // robust regardless of which claims happen to be proven in the fixture.
    assert.ok(tool.claims.length >= 1, "fixture must have >=1 claim");
    tool.claims[0].status = "proven";
    delete tool.claims[0].evidenceRefs;
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 when a proven claim has no evidenceRefs; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /evidenceRefs|required|proven/i,
      `output should mention the missing evidenceRefs; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects a claim referencing an evidenceRef not in the manifest (exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("dangling-ev");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Promote the first claim to "proven" and point its evidenceRefs at a
    // bogus ID. validate.mjs checks evidenceRef integrity for any claim that
    // has evidenceRefs (proven or otherwise), but using a proven claim makes
    // the test independent of whether the manifest contains any entries.
    assert.ok(tool.claims.length >= 1, "fixture must have >=1 claim");
    tool.claims[0].status = "proven";
    tool.claims[0].evidenceRefs = ["ev.zip-meta-map.does-not-exist.v1"];
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 when evidenceRef is not in manifest; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /not in the manifest|ev\.zip-meta-map\.does-not-exist\.v1/,
      `output should mention the missing evidence; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects a forbidden phrase appearing in a message text (I12, exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("forbidden-phrase");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Sanity: the fixture must declare at least one forbidden phrase so this
    // test exercises real-world I12 enforcement.
    const forbidden = tool.press?.boilerplate?.forbiddenPhrases;
    assert.ok(
      Array.isArray(forbidden) && forbidden.length > 0,
      "fixture must declare press.boilerplate.forbiddenPhrases for I12 to fire",
    );
    const phrase = forbidden[0]; // e.g., "AI-powered"
    assert.ok(tool.messages.length >= 1, "fixture must have >=1 message");
    // Inject the forbidden phrase verbatim into the first message text. Keep
    // the rest of the text so any constraint violation noise is unrelated.
    tool.messages[0].text = `${phrase} ${tool.messages[0].text}`;
    // Bump constraints so the injection doesn't trip maxChars/maxSentences
    // first — we want to assert specifically on I12.
    if (tool.messages[0].constraints) {
      tool.messages[0].constraints.maxChars = 10000;
      tool.messages[0].constraints.maxSentences = 100;
    }
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on forbidden phrase; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /forbidden phrase/i,
      `output should mention 'forbidden phrase'; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects a message text exceeding declared maxChars (I13, exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("max-chars");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Find a message that already declares maxChars (the fixture has several).
    const idx = tool.messages.findIndex(
      (m) => m.constraints && typeof m.constraints.maxChars === "number",
    );
    assert.ok(idx >= 0, "fixture must have >=1 message with constraints.maxChars set for I13 test");
    const max = tool.messages[idx].constraints.maxChars;
    // Pad the text past max with neutral chars (no terminator → no extra
    // sentences) so we strictly exceed maxChars without tripping forbidden
    // phrases or maxSentences.
    tool.messages[idx].text = "a".repeat(max + 50);
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on maxChars overflow; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /exceeds maxChars/i,
      `output should mention 'exceeds maxChars'; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects a message text exceeding declared maxSentences (I14, exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("max-sentences");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Inject a message with maxSentences=2 and 5 sentences. Don't rely on the
    // fixture declaring maxSentences itself — set it explicitly so the test
    // is independent of fixture drift.
    assert.ok(tool.messages.length >= 1, "fixture must have >=1 message");
    tool.messages[0].text = "First. Second. Third. Fourth. Fifth.";
    tool.messages[0].constraints = { maxSentences: 2, maxChars: 10000 };
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on maxSentences overflow; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /exceeds maxSentences/i,
      `output should mention 'exceeds maxSentences'; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("rejects an evidence file whose bytes no longer match the manifest sha256 (I11, exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("evidence-tamper");
    cleanup.push(tempRoot);

    // I11 fires only when an evidence entry has a `path` field. The fixture's
    // manifest may be empty (entries can be downgraded as upstream repos
    // become / leave proven status), so this test seeds its own entry +
    // backing file into the temp tree to be independent of fixture drift.
    const evidenceDir = join(tempRoot, "marketing/evidence");
    mkdirSync(evidenceDir, { recursive: true });
    const evidenceRel = "evidence/i11-tamper-fixture.bin";
    const evidenceAbs = join(tempRoot, "marketing", evidenceRel);
    const goodBytes = Buffer.from("hello world", "utf-8");
    writeFileSync(evidenceAbs, goodBytes);
    const goodSha = createHash("sha256").update(goodBytes).digest("hex");

    const manifestPath = join(tempRoot, "marketing/manifests/evidence.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.entries.push({
      id: "ev.i11-tamper.fixture.v1",
      type: "image",
      format: "image/png",
      path: evidenceRel,
      sha256: goodSha,
      bytes: goodBytes.length,
      provenance: {
        generator: "test/validate.test.mjs",
        sourceCommit: "0000000000000000000000000000000000000000",
        notes: "Synthetic fixture for I11 negative test.",
      },
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    // Tamper: append a single byte. Both sha256 and bytes will mismatch;
    // validate.mjs reports both. We assert on sha256 — it's the load-bearing
    // invariant.
    writeFileSync(evidenceAbs, Buffer.concat([goodBytes, Buffer.from([0])]));

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on evidence sha256 mismatch; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr + result.stdout,
      /sha256 mismatch/i,
      `output should mention 'sha256 mismatch'; got stdout=${result.stdout} stderr=${result.stderr}`,
    );
  });

  it("accepts an aspirational claim with no evidenceRefs (schema conditional is proven-only)", () => {
    // Build a tiny tree with one aspirational claim that has NO evidenceRefs.
    // The schema's `if status=proven then required evidenceRefs` conditional
    // must NOT fire for aspirational claims.
    const { tempRoot, validateScript } = makeTempMarketingTree("aspirational-ok");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    // Force every claim to be aspirational with no evidenceRefs — this should
    // still validate cleanly per the schema conditional. (We don't touch
    // messages/claimRefs etc., so all referential integrity is preserved.)
    for (const claim of tool.claims) {
      claim.status = "aspirational";
      delete claim.evidenceRefs;
    }
    writeFileSync(toolPath, JSON.stringify(tool, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      0,
      `validate should exit 0 when all claims are aspirational w/ no evidenceRefs; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  });
});
