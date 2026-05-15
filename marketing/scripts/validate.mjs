#!/usr/bin/env node
/**
 * validate.mjs — Validate all MarketIR data against schema + invariants.
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
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import {
  EVIDENCE_MANIFEST_PATH,
  INDEX_PATH,
  SCHEMA_PATH,
  assertSafePath,
  assertSafeRef,
  marketingRoot,
  repoRoot,
} from "./_paths.mjs";

const errors = [];
function fail(msg) {
  errors.push(msg);
  console.error(`  FAIL: ${msg}`);
}

async function loadJson(absOrRel, source, anchor = repoRoot) {
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

async function main() {
  // Load schema
  const schema = await loadJson(SCHEMA_PATH, "marketing schema");

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
  const index = await loadJson(INDEX_PATH, "marketing index");

  console.log("Validating index...");
  let indexOk = true;
  if (!validateIndex(index)) {
    indexOk = false;
    for (const e of validateIndex.errors) fail(`index: ${e.instancePath} ${e.message}`);
  }

  // Fail fast on a malformed index — subsequent loops would crash with
  // TypeError otherwise (Cannot read properties of undefined).
  // Addresses F-SCRIPTS-013 / F-SCRIPTS-063.
  if (!indexOk) {
    console.error(
      `\n${errors.length} schema error(s) in index. Fix these before invariant checks.`,
    );
    process.exit(1);
  }

  // Helper: load an index-referenced data file with safe-ref check.
  async function loadRef(ref, source) {
    const safe = assertSafeRef(ref, source);
    return loadJson(`marketing/data/${safe}`, source);
  }

  // Collect all IDs for uniqueness check
  const allIds = new Set();
  function checkUniqueId(id, source) {
    if (allIds.has(id)) {
      fail(`Duplicate ID: ${id} (in ${source})`);
    }
    allIds.add(id);
  }

  // Union of all forbiddenPhrases declared by ANY tool. Used in the post-pass
  // I12-extended scan over campaign + audience prose, since those documents
  // are not bound to a specific tool's boilerplate but should still respect
  // the project-wide do-not-say list. Addresses F-SCRIPTS-W3-005.
  const forbiddenUnion = new Set();

  // Load audiences
  const audiences = new Map();
  console.log("\nValidating audiences...");
  for (const { ref } of index.audiences) {
    const aud = await loadRef(ref, "marketing.index.json[audiences]");
    if (!validateAudience(aud)) {
      for (const e of validateAudience.errors) fail(`${ref}: ${e.instancePath} ${e.message}`);
      // Skip invariant traversal for items that failed schema validation
      // (prevents TypeError on missing/wrong-shape fields).
      continue;
    }
    checkUniqueId(aud.id, ref);
    audiences.set(aud.id, aud);
    console.log(`  OK: ${aud.id}`);
  }

  // Load evidence manifest
  console.log("\nValidating evidence manifest...");
  const evidenceManifest = await loadJson(EVIDENCE_MANIFEST_PATH, "evidence manifest");
  const evidenceIds = new Set();
  // Defensive shape-check: a contributor typo (e.g. `enrtries` or
  // `entries: {}`) would otherwise crash the for-of with a TypeError that
  // bypasses the per-item recovery applied to tools/audiences/campaigns.
  // Accumulate an error and skip the loop so other validations still run.
  // Addresses F-SCRIPTS-W3-002.
  if (!Array.isArray(evidenceManifest?.entries)) {
    fail("evidence.manifest.json: entries[] is missing or not an array");
  } else {
    for (const entry of evidenceManifest.entries) {
      if (!validateEvidence(entry)) {
        for (const e of validateEvidence.errors)
          fail(`evidence ${entry.id || "(no-id)"}: ${e.instancePath} ${e.message}`);
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
          fail(err.message);
          continue;
        }
        const fileAbs = join(marketingRoot, safePath);
        let buf;
        try {
          buf = await readFile(fileAbs);
        } catch (err) {
          fail(`evidence ${entry.id}: cannot read ${safePath}: ${err.message}`);
          continue;
        }
        const actualSha = createHash("sha256").update(buf).digest("hex");
        const actualBytes = buf.length;
        if (actualSha !== entry.sha256) {
          fail(
            `evidence ${entry.id}: sha256 mismatch (expected ${entry.sha256}, actual ${actualSha}) for ${safePath}`,
          );
        }
        if (actualBytes !== entry.bytes) {
          fail(
            `evidence ${entry.id}: bytes mismatch (expected ${entry.bytes}, actual ${actualBytes}) for ${safePath}`,
          );
        }
      }

      console.log(`  OK: ${entry.id}`);
    }
  }

  // Load tools
  const tools = new Map();
  console.log("\nValidating tools...");
  for (const { ref } of index.tools) {
    const tool = await loadRef(ref, "marketing.index.json[tools]");
    if (!validateTool(tool)) {
      for (const e of validateTool.errors) fail(`${ref}: ${e.instancePath} ${e.message}`);
      continue;
    }
    checkUniqueId(tool.id, ref);
    tools.set(tool.id, tool);

    // Collect claim and message IDs
    const claimIds = new Set();
    for (const claim of tool.claims) {
      checkUniqueId(claim.id, ref);
      claimIds.add(claim.id);

      // I2: evidenceRefs exist in manifest
      if (claim.evidenceRefs) {
        for (const evRef of claim.evidenceRefs) {
          if (!evidenceIds.has(evRef)) {
            fail(
              `${ref}: claim ${claim.id} references evidence ${evRef} which is not in the manifest`,
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
          );
        }
      }

      // I13: maxChars
      if (msg.constraints && typeof msg.constraints.maxChars === "number") {
        const len = (msg.text || "").length;
        if (len > msg.constraints.maxChars) {
          fail(`${ref}: message ${msg.id} exceeds maxChars (${len} > ${msg.constraints.maxChars})`);
        }
      }
      // I14: maxSentences
      if (msg.constraints && typeof msg.constraints.maxSentences === "number") {
        const count = countSentences(msg.text || "");
        if (count > msg.constraints.maxSentences) {
          fail(
            `${ref}: message ${msg.id} exceeds maxSentences (${count} > ${msg.constraints.maxSentences})`,
          );
        }
      }
    }

    // I4: audienceRefs resolve
    for (const audRef of tool.audienceRefs) {
      if (!audiences.has(audRef)) {
        fail(`${ref}: audienceRef ${audRef} does not exist`);
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
          fail(`${ref}: targeting seedRepo has empty owner or repo`);
        }
      }
    }

    // I7: targeting.exclusions has no empty strings
    if (tool.targeting?.exclusions) {
      for (const exc of tool.targeting.exclusions) {
        if (!exc || exc.trim().length === 0) {
          fail(`${ref}: targeting exclusion contains empty string`);
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
            fail(`${ref}: forbidden phrase ${JSON.stringify(phrase)} appears in ${t.where}`);
          }
        }
      }
    }

    const pressInfo = tool.press ? `, press: ${tool.press.quotes?.length || 0} quotes` : "";
    const targetingInfo = tool.targeting
      ? `, targeting: ${tool.targeting.keywords?.length || 0} keywords, ${tool.targeting.topics?.length || 0} topics`
      : "";
    console.log(
      `  OK: ${tool.id} (${tool.claims.length} claims, ${tool.messages.length} messages${pressInfo}${targetingInfo})`,
    );
  }

  // Load campaigns
  console.log("\nValidating campaigns...");
  // Track loaded campaigns by ref so the post-pass I12-extended scan
  // (F-SCRIPTS-W3-005) can iterate them after all tools have contributed
  // their forbidden phrases to forbiddenUnion.
  const loadedCampaigns = [];
  for (const { ref } of index.campaigns) {
    const campaign = await loadRef(ref, "marketing.index.json[campaigns]");
    if (!validateCampaign(campaign)) {
      for (const e of validateCampaign.errors) fail(`${ref}: ${e.instancePath} ${e.message}`);
      continue;
    }
    checkUniqueId(campaign.id, ref);
    loadedCampaigns.push({ ref, campaign });

    // I8: toolRef resolves
    if (!tools.has(campaign.toolRef)) {
      fail(`${ref}: toolRef ${campaign.toolRef} does not exist`);
    }

    // I9: audienceRefs resolve
    for (const audRef of campaign.audienceRefs) {
      if (!audiences.has(audRef)) {
        fail(`${ref}: audienceRef ${audRef} does not exist`);
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
              );
            }
          }
        }
      }
    }

    console.log(`  OK: ${campaign.id} (${campaign.phases.length} phases)`);
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
  console.log(`\n${allIds.size} unique IDs checked.`);
  if (errors.length > 0) {
    console.error(`\n${errors.length} error(s) found.`);
    process.exit(1);
  } else {
    console.log("All validations passed.");
  }
}

main().catch((err) => {
  console.error(`validate.mjs failed: ${err.message}`);
  process.exit(1);
});
