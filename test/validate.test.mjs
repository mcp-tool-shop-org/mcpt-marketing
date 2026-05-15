import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempMarketingTree } from "./helpers/temp-tree.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCRIPT = join(ROOT, "marketing/scripts/validate.mjs");

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

  // F-W6-TESTS-001 — I12-extended (project-wide forbidden-phrase scan).
  // The per-tool I12 path is already exercised above; these two tests pin
  // the project-wide scope so a regression that scopes I12 back to per-tool
  // only fails CI. validate.mjs:485-539 is the load-bearing block.
  it("rejects a forbidden phrase appearing in an audience description (I12-extended, exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("i12-ext-aud");
    cleanup.push(tempRoot);

    // Pull the project-wide forbidden phrase from the tool fixture so the
    // test stays in sync with whatever the real do-not-say list contains.
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    const forbidden = tool.press?.boilerplate?.forbiddenPhrases;
    assert.ok(
      Array.isArray(forbidden) && forbidden.length > 0,
      "fixture must declare press.boilerplate.forbiddenPhrases for I12-extended to fire",
    );
    const phrase = forbidden[0]; // e.g., "AI-powered"

    // Inject the phrase into the first audience's description. This audience
    // is not bound to any specific tool's boilerplate, so only the
    // I12-extended (forbiddenUnion-based) scan can catch it.
    const audPath = join(tempRoot, "marketing/data/audiences/ci-maintainers.json");
    const aud = JSON.parse(readFileSync(audPath, "utf-8"));
    aud.description = `${phrase} ${aud.description}`;
    writeFileSync(audPath, JSON.stringify(aud, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on forbidden phrase in audience description; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /FAIL:.*forbidden phrase.*audience/i,
      `stderr should mention 'forbidden phrase' AND 'audience'; got: ${result.stderr}`,
    );
  });

  it("rejects a forbidden phrase appearing in a campaign phase notes (I12-extended, exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("i12-ext-camp");
    cleanup.push(tempRoot);

    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    const tool = JSON.parse(readFileSync(toolPath, "utf-8"));
    const forbidden = tool.press?.boilerplate?.forbiddenPhrases;
    assert.ok(
      Array.isArray(forbidden) && forbidden.length > 0,
      "fixture must declare press.boilerplate.forbiddenPhrases for I12-extended to fire",
    );
    const phrase = forbidden[0];

    // Inject into a campaign phase note — neither the campaign nor its phases
    // are bound to a tool's per-tool I12 scan, only to the union scan.
    const campPath = join(tempRoot, "marketing/data/campaigns/zmm-launch.json");
    const camp = JSON.parse(readFileSync(campPath, "utf-8"));
    assert.ok(
      Array.isArray(camp.phases) && camp.phases.length > 0,
      "fixture must have >=1 campaign phase",
    );
    camp.phases[0].notes = `${phrase} ${camp.phases[0].notes || ""}`;
    writeFileSync(campPath, JSON.stringify(camp, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on forbidden phrase in campaign notes; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /FAIL:.*forbidden phrase.*campaign/i,
      `stderr should mention 'forbidden phrase' AND 'campaign'; got: ${result.stderr}`,
    );
  });

  // F-W6-TESTS-003 — error-envelope branches.
  // validate.mjs has multiple defensive guards (lines 81-88 loadJson catch,
  // 216-218 evidence manifest shape guard, 232-237 assertSafePath catch in
  // I11). The Wave-3 hardening notes (F-SCRIPTS-W3-002 etc.) document why
  // these matter; pin them so a refactor that drops the guards fails CI.
  it("reports a one-line envelope when a data file is malformed JSON (exit 1)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("malformed-json");
    cleanup.push(tempRoot);

    // Replace a tool file with intentionally invalid JSON. The loadJson catch
    // (validate.mjs:84-88) should surface a 'Failed to parse' envelope naming
    // the file rather than a raw SyntaxError stack.
    const toolPath = join(tempRoot, "marketing/data/tools/zip-meta-map.json");
    writeFileSync(toolPath, "{not json", "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on malformed tool JSON; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /Failed to parse|JSON/i,
      `stderr should mention 'Failed to parse' or 'JSON'; got: ${result.stderr}`,
    );
    // The envelope must name the file so the contributor knows what to fix.
    assert.match(
      result.stderr,
      /zip-meta-map\.json/,
      `stderr should name the offending file; got: ${result.stderr}`,
    );
    // Defense-in-depth: the message should NOT include the multi-line Node
    // stack. Our envelope is a single line.
    assert.ok(
      !/\n\s+at\s/.test(result.stderr),
      `stderr should not contain a Node stack trace; got: ${result.stderr}`,
    );
  });

  it("reports a clean error when evidence manifest entries[] is the wrong shape (no crash)", () => {
    // F-SCRIPTS-W3-002: a contributor typo like `enrtries: []` (or any shape
    // that makes entries non-array) must NOT crash with a TypeError that
    // bypasses the per-item recovery elsewhere in validate.mjs.
    const { tempRoot, validateScript } = makeTempMarketingTree("manifest-shape");
    cleanup.push(tempRoot);

    const manifestPath = join(tempRoot, "marketing/manifests/evidence.manifest.json");
    // Drop `entries` entirely — equivalent to a typo that misnames the field.
    writeFileSync(
      manifestPath,
      JSON.stringify({ schemaVersion: "1.0.0", enrtries: [] }, null, 2),
      "utf-8",
    );

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on bad evidence manifest shape; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // It must report the manifest issue with a meaningful 'FAIL: ...' line —
    // not a raw 'Cannot read properties of undefined' TypeError.
    assert.match(
      result.stderr,
      /FAIL:.*entries.*missing|FAIL:.*not an array|evidence\.manifest\.json/i,
      `stderr should mention the manifest entries[] guard; got: ${result.stderr}`,
    );
    assert.ok(
      !/TypeError/i.test(result.stderr),
      `stderr should not surface a raw TypeError; got: ${result.stderr}`,
    );
  });

  it("reports an Unsafe path error when an evidence path attempts traversal (exit 1)", () => {
    // The assertSafePath catch at validate.mjs:232-237 demotes a path-pattern
    // violation into a fail() accumulation rather than letting the Error
    // propagate to the top-level catch (which would be less informative).
    const { tempRoot, validateScript } = makeTempMarketingTree("path-traversal");
    cleanup.push(tempRoot);

    const manifestPath = join(tempRoot, "marketing/manifests/evidence.manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    // Synthesize a manifest entry with a traversal path. We don't need the
    // file to exist — the safe-path check fires before the readFile call.
    manifest.entries.push({
      id: "ev.path-traversal.fixture.v1",
      type: "image",
      format: "image/png",
      path: "../etc/passwd",
      sha256: "0".repeat(64),
      bytes: 0,
      provenance: {
        generator: "test/validate.test.mjs",
        sourceCommit: "0000000000000000000000000000000000000000",
        notes: "Synthetic fixture for assertSafePath catch.",
      },
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on traversal path; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    assert.match(
      result.stderr,
      /FAIL:.*Unsafe path/,
      `stderr should mention 'Unsafe path'; got: ${result.stderr}`,
    );
  });

  // F-W6-TESTS-006 — schema/runtime drift on fileRef pattern.
  // The schema's fileRef pattern (marketing.schema.json:637) currently allows
  // leading-dot segments like `.env.json`, while the runtime _paths.mjs
  // REF_PATTERN rejects them. We pin that the SYSTEM (whichever layer
  // catches it) rejects this input so when contract harmonizes the two
  // patterns, this test continues to pass with a clearer error path.
  it("rejects an index ref with a leading-dot segment (system-level, schema OR runtime)", () => {
    const { tempRoot, validateScript } = makeTempMarketingTree("dotfile-ref");
    cleanup.push(tempRoot);

    const indexPath = join(tempRoot, "marketing/data/marketing.index.json");
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    // Inject a leading-dot ref into tools[]. Whether the schema or the
    // runtime assertSafeRef catches it is acceptable — what matters is that
    // the system rejects it (cross-domain invariant pin).
    index.tools.push({ ref: ".env.json" });
    writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");

    const result = runValidate(validateScript, tempRoot);
    assert.equal(
      result.status,
      1,
      `validate should exit 1 on a leading-dot ref; got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
    // Match either error path: schema pattern violation OR runtime
    // assertSafeRef rejection. When contract harmonizes the two patterns,
    // one of these will be the surviving path.
    assert.match(
      result.stderr,
      /Unsafe ref|pattern|\.env\.json/,
      `stderr should reject the leading-dot ref by some path; got: ${result.stderr}`,
    );
  });
});
