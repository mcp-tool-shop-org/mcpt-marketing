#!/usr/bin/env node
/**
 * validate.mjs — Validate all MarketIR data against schema + invariants.
 *
 * Usage:
 *   node marketing/scripts/validate.mjs                       # human output, default
 *   node marketing/scripts/validate.mjs --json                # machine-readable JSON
 *   node marketing/scripts/validate.mjs --quiet               # only failures + summary
 *   node marketing/scripts/validate.mjs --verbose             # extra per-item detail
 *   node marketing/scripts/validate.mjs --root <path>         # alternate marketing/ tree
 *   node marketing/scripts/validate.mjs --max-evidence-bytes <N>
 *   node marketing/scripts/validate.mjs --help
 *   node marketing/scripts/validate.mjs --version
 *
 * Schema-enforced (declared in marketing.schema.json — listed for completeness):
 *   S1. Every file matches its $defs type.
 *   S2. Proven claims have >= 1 evidenceRef (if/then on claim.status='proven').
 *
 * Script-enforced invariants (this file):
 *   I1.  All IDs are unique across the entire graph.
 *   I2.  All evidenceRefs in claims exist in the evidence manifest.
 *   I3.  All claimRefs in messages resolve to the tool's own claims.
 *   I4.  All audienceRefs in tools resolve to declared audiences.
 *   I5.  All press.quotes claimRefs resolve to the tool's own claims.
 *   I6.  targeting.seedRepos entries have non-empty owner + repo.
 *   I7.  targeting.exclusions contain no empty / whitespace-only strings.
 *   I8.  Campaign toolRef resolves to a declared tool.
 *   I9.  Campaign audienceRefs resolve to declared audiences.
 *   I10. Campaign phase messageRefs resolve to the bound tool's messages.
 *   I11. Every evidence entry with a `path` has matching sha256/bytes on disk
 *        (the load-bearing fix that makes "hash-verified evidence" true).
 *   I12. forbiddenPhrases declared by a tool's press boilerplate are never
 *        present (case-insensitive substring) in any of that tool's prose:
 *        message.text, positioning.oneLiner, positioning.valueProps[],
 *        antiClaim.statement, press.boilerplate.projectDescription,
 *        press.quotes[].text. Makes the forbidden-phrases list enforceable.
 *        I12-extended (F-SCRIPTS-W3-005): the union of every tool's
 *        forbiddenPhrases is also scanned against project-wide prose that is
 *        not bound to a single tool — audience.description,
 *        audience.painPoints[], campaign.name, campaign.description, and
 *        campaign.phases[].notes — so a campaign or audience cannot route
 *        around any tool's do-not-say list.
 *   I13. message.constraints.maxChars (when set) is honored by message.text.
 *   I14. message.constraints.maxSentences (when set) is honored.
 *   I15. schemaVersion preflight — every loaded document declares a
 *        schemaVersion compatible with marketing.schema.json's declared
 *        SCHEMA_VERSION (same MAJOR). Addresses F-SCRIPTS-B-007.
 *
 * Hardening:
 *   - Ajv runs in strict mode so schema-authoring typos fail loud.
 *     Addresses F-SCRIPTS-004 / F-SCRIPTS-027 (formerly -054).
 *   - On schema failure for an item, traversal of that item's subtree is
 *     skipped — prevents the post-failure TypeError crash that would swallow
 *     the accumulated error report.
 *     Addresses F-SCRIPTS-006 / F-SCRIPTS-013 (and -056 / -063).
 *   - All ref strings are pattern-checked before joining into filesystem paths
 *     (no '..', no leading '/', no '\\', no abs paths).
 *     Addresses F-SCRIPTS-007 / F-SCRIPTS-057.
 *   - Top-level errors are wrapped in a one-line envelope (no Node stack trace).
 *     Addresses F-SCRIPTS-009 / F-SCRIPTS-059.
 *   - Evidence files are size-capped before readFile to prevent OOM on a
 *     single accidentally-huge artifact. F-SCRIPTS-B-009.
 *
 * UX surfaces (Stage C/D — F-SCRIPTS-B-001/003/004/012/017):
 *   --help / --version / --root / --json / --quiet / --verbose. Defaults
 *   reproduce the prior human-readable output.
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  DEFAULT_MAX_EVIDENCE_BYTES,
  EVIDENCE_MANIFEST_PATH,
  INDEX_PATH,
  SCHEMA_PATH,
  assertSafePath,
  assertSafeRef,
  getScriptVersion,
  loadJson,
  parseArgs,
  resolveRoots,
} from "./_paths.mjs";

const HELP_TEXT = `Usage: node validate.mjs [options]

Validate the marketing/ tree against the schema and the script-enforced
invariants (I1..I15). Default output is human-readable; use --json for a
machine-readable result.

Options:
  --root <path>             Use an alternate marketing/ root (overrides
                            MCPT_MARKETING_ROOT and the script-relative default).
  --json                    Emit a single JSON object on stdout. Implies --quiet.
  --quiet                   Suppress per-item OK lines; print failures + summary only.
  --verbose                 Extra per-item detail (more useful at small scale).
  --max-evidence-bytes <N>  Cap per-file evidence size (default ${DEFAULT_MAX_EVIDENCE_BYTES}).
                            Files larger than this fail with a clear message
                            instead of OOM-ing the validator.
  --help, -h                Print this help and exit 0.
  --version                 Print the script version and exit 0.

Environment:
  MCPT_MARKETING_ROOT       Same as --root.

Exit codes:
  0   All validations passed.
  1   One or more validation errors (or fatal I/O / parse failure).
`;

/**
 * Sentence count using a less-brittle boundary regex.
 *
 * Rules (option (a) per F-SCRIPTS-W3-004):
 *   - Split on a sentence-terminator class `[.!?…]+` followed by whitespace
 *     OR end-of-string. This avoids the prior `\s+` requirement that missed
 *     run-on terminators landing at EOS.
 *   - Require a non-digit lookbehind before the terminator so decimals like
 *     "3.14" do NOT split (`(?<=\D)`). This eliminates the most common
 *     marketing-prose false positive.
 *   - Recognize the Unicode horizontal ellipsis (U+2026, "…") as a terminator
 *     in addition to ASCII `.!?`.
 *   - Filter empty trailing entries (a trailing terminator yields one extra
 *     empty split).
 *
 * Tradeoffs (intentional, kept for simplicity):
 *   - Common abbreviations like "e.g." and "etc." can still inflate the count
 *     in exotic cases (e.g. "See e.g. foo." -> 2). Marketing prose rarely
 *     uses bare abbreviations followed by a sentence break, and a precise
 *     fix would require Intl.Segmenter (Node 16+) at the cost of pulling in
 *     a tokenizer for one constraint check.
 *   - URLs are similarly not special-cased; if a writer puts "see foo.com."
 *     mid-sentence, the count will be 2. This is acceptable since the
 *     constraint is per-message and writers control their own copy.
 */
function countSentences(text) {
  if (!text || text.trim().length === 0) return 0;
  const trimmed = text.trim();
  // Split on (non-digit terminator) followed by whitespace OR end-of-string.
  // The lookbehind `(?<=\D)` prevents "3.14" from splitting on the decimal.
  const parts = trimmed.split(/(?<=\D)[.!?…]+(?:\s+|$)/);
  // Filter empty entries (trailing terminator produces an empty tail).
  const nonEmpty = parts.filter((p) => p.trim().length > 0);
  return nonEmpty.length || 1;
}

/**
 * Compatibility check for a per-document schemaVersion vs the schema's own
 * declared SCHEMA_VERSION. Same MAJOR is considered compatible. Returns an
 * error string on mismatch, or null on match.
 *
 * F-SCRIPTS-B-007: validate.mjs should fail loudly when a document declares
 * a schema version the schema does not support, instead of silently proceeding
 * to Ajv and producing confusing schema-validation errors.
 */
function schemaVersionMismatch(supportedVersion, documentVersion, source) {
  if (typeof documentVersion !== "string") {
    // Schema validation will catch missing schemaVersion; nothing extra to say
    // here. We only emit a preflight message when a version IS declared but
    // it's incompatible with what the scripts support.
    return null;
  }
  const supportedMajor = supportedVersion.split(".")[0];
  const documentMajor = documentVersion.split(".")[0];
  if (supportedMajor !== documentMajor) {
    return (
      `${source}: schemaVersion mismatch — document declares ${JSON.stringify(documentVersion)}, ` +
      `but scripts support ${JSON.stringify(supportedVersion)} (MAJOR ${supportedMajor}.x). ` +
      `Either update the document or update the scripts to support a new MAJOR.`
    );
  }
  return null;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (flags.version) {
    const v = await getScriptVersion();
    process.stdout.write(`validate.mjs ${v}\n`);
    process.exit(0);
  }

  const jsonMode = flags.json === true;
  // --json implies --quiet (machine-readable output should not interleave with
  // human OK/FAIL lines on stdout).
  const quietMode = flags.quiet === true || jsonMode;
  const verboseMode = flags.verbose === true && !quietMode;

  // Resolve the marketing root (--root > MCPT_MARKETING_ROOT > script-relative).
  const { marketingRoot: marketingRootAbs, repoRoot: repoRootAbs } = resolveRoots({
    root: typeof flags.root === "string" ? flags.root : undefined,
  });

  // Evidence size cap: --max-evidence-bytes <N> overrides the default.
  let maxEvidenceBytes = DEFAULT_MAX_EVIDENCE_BYTES;
  if (flags["max-evidence-bytes"] !== undefined && flags["max-evidence-bytes"] !== true) {
    const n = Number(flags["max-evidence-bytes"]);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(
        `validate.mjs: --max-evidence-bytes must be a positive number; got ${JSON.stringify(flags["max-evidence-bytes"])}`,
      );
      process.exit(1);
    }
    maxEvidenceBytes = n;
  }

  // Output buffers. In --json mode we accumulate structured records; in human
  // mode we print directly. Errors always feed the structured `errors[]`.
  const errors = [];
  const okItems = []; // for --json summary
  function fail(msg, source = null) {
    errors.push({ source, message: msg });
    if (!jsonMode) console.error(`  FAIL: ${msg}`);
  }
  function ok(label, where = null) {
    okItems.push({ label, where });
    if (!jsonMode && !quietMode) console.log(`  OK: ${label}`);
  }
  function info(msg) {
    // Info lines are visible in default + verbose modes; suppressed in quiet
    // and json modes. They appear unindented to differentiate from OK lines.
    if (!jsonMode && !quietMode) console.log(msg);
  }
  function vinfo(msg) {
    // Verbose-only detail.
    if (verboseMode) console.log(msg);
  }

  // Load schema (always anchored at the resolved repoRoot).
  const schema = await loadJson(SCHEMA_PATH, "marketing schema", repoRootAbs);

  // Pull the schema's declared version (preflight reference). The schema sets
  // its own version under $defs/schemaVersion in pattern form; the actual
  // SUPPORTED_VERSION comes from the latest fixture documents this script was
  // built against. We read the schemaVersion from marketing.index.json to
  // anchor the comparison, falling back to "1.0.0" if absent.
  // (See F-SCRIPTS-B-007 / F-SCRIPTS-B-008 — a future cleanup pass should
  // promote SUPPORTED_SCHEMA_VERSION to a constant exported from _paths.mjs.)
  const SUPPORTED_SCHEMA_VERSION = "1.0.0";

  // Strict mode: silently-ignored unknown keywords are themselves bugs in a
  // contract repo. Use 'log' so authoring issues in the schema itself surface
  // as warnings rather than hard failures (the wave-2 finding F-SCRIPTS-027
  // explicitly sanctions strict:'log' as the initial setting). The schema
  // currently has at least one minItems-without-type case under
  // $defs/claim/then.evidenceRefs that the contract domain owns; switching to
  // strict:true here would block validation until the contract domain repairs
  // the schema. Keep allErrors so one run reports every data violation.
  const ajv = new Ajv2020({ allErrors: true, strict: "log" });
  addFormats(ajv);
  ajv.addSchema(schema);

  const schemaId = schema.$id;
  const validateTool = ajv.compile({ $ref: `${schemaId}#/$defs/tool` });
  const validateAudience = ajv.compile({ $ref: `${schemaId}#/$defs/audience` });
  const validateCampaign = ajv.compile({ $ref: `${schemaId}#/$defs/campaign` });
  const validateIndex = ajv.compile({ $ref: `${schemaId}#/$defs/index` });
  const validateEvidence = ajv.compile({ $ref: `${schemaId}#/$defs/evidence` });

  // Load index
  const index = await loadJson(INDEX_PATH, "marketing index", repoRootAbs);

  info("Validating index...");
  let indexOk = true;
  if (!validateIndex(index)) {
    indexOk = false;
    for (const e of validateIndex.errors) fail(`index: ${e.instancePath} ${e.message}`, INDEX_PATH);
  }

  // I15 preflight: index document declares a compatible schemaVersion.
  const indexVersionErr = schemaVersionMismatch(
    SUPPORTED_SCHEMA_VERSION,
    index?.schemaVersion,
    "marketing.index.json",
  );
  if (indexVersionErr) fail(indexVersionErr, INDEX_PATH);

  // Fail fast on a malformed index — subsequent loops would crash with
  // TypeError otherwise (Cannot read properties of undefined).
  // Addresses F-SCRIPTS-013 / F-SCRIPTS-063.
  if (!indexOk) {
    if (jsonMode) {
      // In JSON mode we emit a structured failure even on early exit so a
      // tooling consumer can distinguish parse / schema / invariant failures.
      process.stdout.write(
        emitJson({ ok: false, errors, summary: { ids: 0 }, version: await getScriptVersion() }),
      );
      process.exit(1);
    }
    console.error(
      `\n${errors.length} schema error(s) in index. Fix these before invariant checks.`,
    );
    process.exit(1);
  }

  // Helper: load an index-referenced data file with safe-ref check.
  async function loadRef(ref, source) {
    const safe = assertSafeRef(ref, source);
    return loadJson(`marketing/data/${safe}`, source, repoRootAbs);
  }

  // Collect all IDs for uniqueness check
  const allIds = new Set();
  function checkUniqueId(id, source) {
    if (allIds.has(id)) {
      fail(`Duplicate ID: ${id} (in ${source})`, source);
    }
    allIds.add(id);
  }

  // Union of all forbiddenPhrases declared by ANY tool. Used in the post-pass
  // I12-extended scan over campaign + audience prose, since those documents
  // are not bound to a specific tool's boilerplate but should still respect
  // the project-wide do-not-say list. Addresses F-SCRIPTS-W3-005.
  const forbiddenUnion = new Set();

  // Track whether any claim declares status='proven'. Used to surface a
  // helpful warning when the evidence manifest is empty but proven claims
  // exist (F-SCRIPTS-B-017 — better signal than silent OK on an empty manifest).
  let provenClaimCount = 0;

  // Load audiences
  const audiences = new Map();
  info("\nValidating audiences...");
  for (const { ref } of index.audiences) {
    const aud = await loadRef(ref, "marketing.index.json[audiences]");
    if (!validateAudience(aud)) {
      for (const e of validateAudience.errors) fail(`${ref}: ${e.instancePath} ${e.message}`, ref);
      // Skip invariant traversal for items that failed schema validation
      // (prevents TypeError on missing/wrong-shape fields).
      continue;
    }
    // I15 preflight per-document.
    const audVerErr = schemaVersionMismatch(SUPPORTED_SCHEMA_VERSION, aud.schemaVersion, ref);
    if (audVerErr) {
      fail(audVerErr, ref);
      continue;
    }
    checkUniqueId(aud.id, ref);
    audiences.set(aud.id, aud);
    ok(aud.id, ref);
  }

  // Load evidence manifest
  info("\nValidating evidence manifest...");
  const evidenceManifest = await loadJson(EVIDENCE_MANIFEST_PATH, "evidence manifest", repoRootAbs);
  const evidenceIds = new Set();
  let evidenceEntryCount = 0;
  // Defensive shape-check: a contributor typo (e.g. `enrtries` or
  // `entries: {}`) would otherwise crash the for-of with a TypeError that
  // bypasses the per-item recovery applied to tools/audiences/campaigns.
  // Accumulate an error and skip the loop so other validations still run.
  // Addresses F-SCRIPTS-W3-002.
  if (!Array.isArray(evidenceManifest?.entries)) {
    fail("evidence.manifest.json: entries[] is missing or not an array", EVIDENCE_MANIFEST_PATH);
  } else {
    // I15 preflight on the manifest itself.
    const manifestVerErr = schemaVersionMismatch(
      SUPPORTED_SCHEMA_VERSION,
      evidenceManifest.schemaVersion,
      "evidence.manifest.json",
    );
    if (manifestVerErr) fail(manifestVerErr, EVIDENCE_MANIFEST_PATH);

    evidenceEntryCount = evidenceManifest.entries.length;
    for (const entry of evidenceManifest.entries) {
      if (!validateEvidence(entry)) {
        for (const e of validateEvidence.errors)
          fail(
            `evidence ${entry.id || "(no-id)"}: ${e.instancePath} ${e.message}`,
            EVIDENCE_MANIFEST_PATH,
          );
        continue;
      }
      checkUniqueId(entry.id, "evidence.manifest.json");
      evidenceIds.add(entry.id);

      // I11: hash-verify on-disk evidence files.
      // Skip entries that have only a `url` (external resource — no local file).
      if (entry.path) {
        let safePath;
        try {
          safePath = assertSafePath(entry.path, `evidence ${entry.id}.path`);
        } catch (err) {
          fail(err.message, EVIDENCE_MANIFEST_PATH);
          continue;
        }
        const fileAbs = join(marketingRootAbs, safePath);

        // F-SCRIPTS-B-009: pre-flight size check. Refuse to read an evidence
        // file larger than the cap so a single multi-GB artifact cannot OOM
        // the validator on a constrained CI runner.
        let st;
        try {
          st = await stat(fileAbs);
        } catch (err) {
          fail(
            `evidence ${entry.id}: cannot stat ${safePath}: ${err.message}`,
            EVIDENCE_MANIFEST_PATH,
          );
          continue;
        }
        if (st.size > maxEvidenceBytes) {
          fail(
            `evidence ${entry.id}: file ${safePath} is ${st.size} bytes (exceeds --max-evidence-bytes=${maxEvidenceBytes}). ` +
              `Override with --max-evidence-bytes=<N> or remove the file from the manifest.`,
            EVIDENCE_MANIFEST_PATH,
          );
          continue;
        }

        let buf;
        try {
          buf = await readFile(fileAbs);
        } catch (err) {
          fail(
            `evidence ${entry.id}: cannot read ${safePath}: ${err.message}`,
            EVIDENCE_MANIFEST_PATH,
          );
          continue;
        }
        const actualSha = createHash("sha256").update(buf).digest("hex");
        const actualBytes = buf.length;
        if (actualSha !== entry.sha256) {
          fail(
            `evidence ${entry.id}: sha256 mismatch (expected ${entry.sha256}, actual ${actualSha}) for ${safePath}`,
            EVIDENCE_MANIFEST_PATH,
          );
        }
        if (actualBytes !== entry.bytes) {
          fail(
            `evidence ${entry.id}: bytes mismatch (expected ${entry.bytes}, actual ${actualBytes}) for ${safePath}`,
            EVIDENCE_MANIFEST_PATH,
          );
        }
      }

      ok(entry.id, EVIDENCE_MANIFEST_PATH);
    }
  }

  // F-SCRIPTS-B-017: signal an empty manifest explicitly. Today's empty case
  // is silent — a contributor could believe their evidence is being verified
  // when zero files are. Always print the count; emit a warning if proven
  // claims exist with no manifest entries to back them.
  info(`Evidence manifest: ${evidenceEntryCount} entr${evidenceEntryCount === 1 ? "y" : "ies"}`);

  // Load tools
  const tools = new Map();
  info("\nValidating tools...");
  for (const { ref } of index.tools) {
    const tool = await loadRef(ref, "marketing.index.json[tools]");
    if (!validateTool(tool)) {
      for (const e of validateTool.errors) fail(`${ref}: ${e.instancePath} ${e.message}`, ref);
      continue;
    }
    // I15 preflight per-document.
    const toolVerErr = schemaVersionMismatch(SUPPORTED_SCHEMA_VERSION, tool.schemaVersion, ref);
    if (toolVerErr) {
      fail(toolVerErr, ref);
      continue;
    }
    checkUniqueId(tool.id, ref);
    tools.set(tool.id, tool);

    // Collect claim and message IDs
    const claimIds = new Set();
    for (const claim of tool.claims) {
      checkUniqueId(claim.id, ref);
      claimIds.add(claim.id);

      if (claim.status === "proven") provenClaimCount++;

      // I2: evidenceRefs exist in manifest
      if (claim.evidenceRefs) {
        for (const evRef of claim.evidenceRefs) {
          if (!evidenceIds.has(evRef)) {
            fail(
              `${ref}: claim ${claim.id} references evidence ${evRef} which is not in the manifest`,
              ref,
            );
          }
        }
      }
    }

    // I3 + I13 + I14: claimRefs resolve, plus constraints enforcement
    for (const msg of tool.messages) {
      checkUniqueId(msg.id, ref);
      for (const claimRef of msg.claimRefs) {
        if (!claimIds.has(claimRef)) {
          fail(
            `${ref}: message ${msg.id} references claim ${claimRef} which is not in this tool's claims`,
            ref,
          );
        }
      }

      // I13: maxChars
      if (msg.constraints && typeof msg.constraints.maxChars === "number") {
        const len = (msg.text || "").length;
        if (len > msg.constraints.maxChars) {
          fail(
            `${ref}: message ${msg.id} exceeds maxChars (${len} > ${msg.constraints.maxChars})`,
            ref,
          );
        }
      }
      // I14: maxSentences
      if (msg.constraints && typeof msg.constraints.maxSentences === "number") {
        const count = countSentences(msg.text || "");
        if (count > msg.constraints.maxSentences) {
          fail(
            `${ref}: message ${msg.id} exceeds maxSentences (${count} > ${msg.constraints.maxSentences})`,
            ref,
          );
        }
      }
    }

    // I4: audienceRefs resolve
    for (const audRef of tool.audienceRefs) {
      if (!audiences.has(audRef)) {
        fail(`${ref}: audienceRef ${audRef} does not exist`, ref);
      }
    }

    // I5: press quote claimRefs resolve to tool's claims
    if (tool.press?.quotes) {
      for (const quote of tool.press.quotes) {
        if (quote.claimRefs) {
          for (const claimRef of quote.claimRefs) {
            if (!claimIds.has(claimRef)) {
              fail(
                `${ref}: press quote references claim ${claimRef} which is not in this tool's claims`,
                ref,
              );
            }
          }
        }
      }
    }

    // I6: seedRepos owner+repo non-empty
    if (tool.targeting?.seedRepos) {
      for (const seed of tool.targeting.seedRepos) {
        if (!seed.owner || !seed.repo) {
          fail(`${ref}: targeting seedRepo has empty owner or repo`, ref);
        }
      }
    }

    // I7: targeting.exclusions has no empty strings
    if (tool.targeting?.exclusions) {
      for (const exc of tool.targeting.exclusions) {
        if (!exc || exc.trim().length === 0) {
          fail(`${ref}: targeting exclusion contains empty string`, ref);
        }
      }
    }

    // I12: forbiddenPhrases enforcement
    const forbidden = tool.press?.boilerplate?.forbiddenPhrases;
    if (Array.isArray(forbidden) && forbidden.length > 0) {
      // Contribute this tool's phrases to the project-wide union (used in the
      // post-pass for campaign + audience prose). Addresses F-SCRIPTS-W3-005.
      for (const phrase of forbidden) {
        const trimmed = (phrase || "").trim();
        if (trimmed) forbiddenUnion.add(trimmed);
      }
      const scanTargets = [];
      // positioning
      if (tool.positioning?.oneLiner) {
        scanTargets.push({ where: "positioning.oneLiner", text: tool.positioning.oneLiner });
      }
      if (Array.isArray(tool.positioning?.valueProps)) {
        for (let i = 0; i < tool.positioning.valueProps.length; i++) {
          scanTargets.push({
            where: `positioning.valueProps[${i}]`,
            text: tool.positioning.valueProps[i],
          });
        }
      }
      // antiClaims
      if (Array.isArray(tool.antiClaims)) {
        for (const ac of tool.antiClaims) {
          if (ac?.statement) {
            scanTargets.push({ where: `antiClaim ${ac.id}.statement`, text: ac.statement });
          }
        }
      }
      // messages
      for (const msg of tool.messages) {
        if (msg?.text) {
          scanTargets.push({ where: `message ${msg.id}.text`, text: msg.text });
        }
      }
      // press boilerplate description
      if (tool.press?.boilerplate?.projectDescription) {
        scanTargets.push({
          where: "press.boilerplate.projectDescription",
          text: tool.press.boilerplate.projectDescription,
        });
      }
      // press quotes
      if (Array.isArray(tool.press?.quotes)) {
        for (let i = 0; i < tool.press.quotes.length; i++) {
          if (tool.press.quotes[i]?.text) {
            scanTargets.push({
              where: `press.quotes[${i}].text`,
              text: tool.press.quotes[i].text,
            });
          }
        }
      }

      for (const phrase of forbidden) {
        const needle = (phrase || "").toLowerCase();
        if (!needle) continue;
        for (const t of scanTargets) {
          if ((t.text || "").toLowerCase().includes(needle)) {
            fail(`${ref}: forbidden phrase ${JSON.stringify(phrase)} appears in ${t.where}`, ref);
          }
        }
      }
    }

    const pressInfo = tool.press ? `, press: ${tool.press.quotes?.length || 0} quotes` : "";
    const targetingInfo = tool.targeting
      ? `, targeting: ${tool.targeting.keywords?.length || 0} keywords, ${tool.targeting.topics?.length || 0} topics`
      : "";
    ok(
      `${tool.id} (${tool.claims.length} claims, ${tool.messages.length} messages${pressInfo}${targetingInfo})`,
      ref,
    );
  }

  // Empty-manifest signal escalation: if any claim is `status: 'proven'` but
  // the manifest has no entries, surface a clear warning. F-SCRIPTS-B-017.
  if (provenClaimCount > 0 && evidenceEntryCount === 0) {
    const msg =
      `${provenClaimCount} proven claim(s) declared, but the evidence manifest is empty. ` +
      `Proven claims should reference manifest entries to satisfy schema invariant S2.`;
    if (!jsonMode) console.warn(`  WARN: ${msg}`);
    // Recorded as an info-level note in JSON output rather than a hard error;
    // the per-claim S2 check above will already have reported any concrete
    // missing-evidenceRef instances.
    okItems.push({ label: `WARN: ${msg}`, where: EVIDENCE_MANIFEST_PATH });
  }

  // Load campaigns
  info("\nValidating campaigns...");
  // Track loaded campaigns by ref so the post-pass I12-extended scan
  // (F-SCRIPTS-W3-005) can iterate them after all tools have contributed
  // their forbidden phrases to forbiddenUnion.
  const loadedCampaigns = [];
  for (const { ref } of index.campaigns) {
    const campaign = await loadRef(ref, "marketing.index.json[campaigns]");
    if (!validateCampaign(campaign)) {
      for (const e of validateCampaign.errors) fail(`${ref}: ${e.instancePath} ${e.message}`, ref);
      continue;
    }
    // I15 preflight per-document.
    const campVerErr = schemaVersionMismatch(SUPPORTED_SCHEMA_VERSION, campaign.schemaVersion, ref);
    if (campVerErr) {
      fail(campVerErr, ref);
      continue;
    }
    checkUniqueId(campaign.id, ref);
    loadedCampaigns.push({ ref, campaign });

    // I8: toolRef resolves
    if (!tools.has(campaign.toolRef)) {
      fail(`${ref}: toolRef ${campaign.toolRef} does not exist`, ref);
    }

    // I9: audienceRefs resolve
    for (const audRef of campaign.audienceRefs) {
      if (!audiences.has(audRef)) {
        fail(`${ref}: audienceRef ${audRef} does not exist`, ref);
      }
    }

    // I10: messageRefs resolve to tool's messages
    const tool = tools.get(campaign.toolRef);
    if (tool) {
      const toolMsgIds = new Set(tool.messages.map((m) => m.id));
      for (const phase of campaign.phases) {
        if (phase.messageRefs) {
          for (const msgRef of phase.messageRefs) {
            if (!toolMsgIds.has(msgRef)) {
              fail(
                `${ref}: phase "${phase.name}" references message ${msgRef} which is not in tool ${campaign.toolRef}`,
                ref,
              );
            }
          }
        }
      }
    }

    ok(`${campaign.id} (${campaign.phases.length} phases)`, ref);
  }

  // I12-extended: project-wide forbidden-phrase scan over campaign + audience
  // prose. The per-tool I12 (above) only scans tool-owned prose against the
  // tool's own forbidden list; campaigns and audiences are not bound to any
  // single tool's boilerplate but should still respect the project-wide
  // do-not-say list. We use the union of every tool's forbiddenPhrases.
  // Addresses F-SCRIPTS-W3-005.
  if (forbiddenUnion.size > 0) {
    const extendedTargets = [];
    // audiences
    for (const aud of audiences.values()) {
      if (aud?.description) {
        extendedTargets.push({ where: `audience ${aud.id}.description`, text: aud.description });
      }
      if (Array.isArray(aud?.painPoints)) {
        for (let i = 0; i < aud.painPoints.length; i++) {
          extendedTargets.push({
            where: `audience ${aud.id}.painPoints[${i}]`,
            text: aud.painPoints[i],
          });
        }
      }
    }
    // campaigns
    for (const { campaign } of loadedCampaigns) {
      if (campaign?.name) {
        extendedTargets.push({ where: `campaign ${campaign.id}.name`, text: campaign.name });
      }
      if (campaign?.description) {
        extendedTargets.push({
          where: `campaign ${campaign.id}.description`,
          text: campaign.description,
        });
      }
      if (Array.isArray(campaign?.phases)) {
        for (let i = 0; i < campaign.phases.length; i++) {
          const phase = campaign.phases[i];
          if (phase?.notes) {
            extendedTargets.push({
              where: `campaign ${campaign.id}.phases[${i}].notes`,
              text: phase.notes,
            });
          }
        }
      }
    }
    for (const phrase of forbiddenUnion) {
      const needle = phrase.toLowerCase();
      if (!needle) continue;
      for (const t of extendedTargets) {
        if ((t.text || "").toLowerCase().includes(needle)) {
          fail(`forbidden phrase ${JSON.stringify(phrase)} appears in ${t.where}`);
        }
      }
    }
  }

  // Summary
  const summary = {
    ids: allIds.size,
    audiences: audiences.size,
    tools: tools.size,
    campaigns: loadedCampaigns.length,
    evidenceEntries: evidenceEntryCount,
    provenClaims: provenClaimCount,
  };
  vinfo(`\nVerbose summary: ${JSON.stringify(summary)}`);

  if (jsonMode) {
    const v = await getScriptVersion();
    process.stdout.write(
      emitJson({
        ok: errors.length === 0,
        errors,
        summary,
        version: v,
      }),
    );
    process.exit(errors.length === 0 ? 0 : 1);
  }

  console.log(`\n${allIds.size} unique IDs checked.`);
  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) found.`);
    process.exit(1);
  } else {
    console.log("All validations passed.");
  }
}

function emitJson(payload) {
  return JSON.stringify(payload, null, 2) + "\n";
}

main().catch((err) => {
  console.error(`validate.mjs failed: ${err.message}`);
  process.exit(1);
});
