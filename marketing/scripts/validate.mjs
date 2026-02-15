#!/usr/bin/env node
/**
 * validate.mjs — Validate all MarketIR data against schema + invariants.
 *
 * Checks:
 * 1. Every file referenced in the index validates against its schema type
 * 2. All IDs are unique across the entire graph
 * 3. Proven claims have >= 1 evidenceRef
 * 4. All evidenceRefs exist in the evidence manifest
 * 5. All claimRefs in messages exist in the tool's claims
 * 6. All audienceRefs exist as audience files
 * 7. Campaign toolRef and audienceRefs resolve
 * 8. Campaign messageRefs resolve to tool messages
 */

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const errors = [];
function fail(msg) {
  errors.push(msg);
  console.error(`  FAIL: ${msg}`);
}

// Load schema
const schemaText = await readFile(join(root, "schema/marketing.schema.json"), "utf8");
const schema = JSON.parse(schemaText);

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schema);

const schemaId = schema.$id;
const validateTool = ajv.compile({ $ref: `${schemaId}#/$defs/tool` });
const validateAudience = ajv.compile({ $ref: `${schemaId}#/$defs/audience` });
const validateCampaign = ajv.compile({ $ref: `${schemaId}#/$defs/campaign` });
const validateIndex = ajv.compile({ $ref: `${schemaId}#/$defs/index` });
const validateEvidence = ajv.compile({ $ref: `${schemaId}#/$defs/evidence` });

// Load index
const indexText = await readFile(join(root, "data/marketing.index.json"), "utf8");
const index = JSON.parse(indexText);

console.log("Validating index...");
if (!validateIndex(index)) {
  for (const e of validateIndex.errors) fail(`index: ${e.instancePath} ${e.message}`);
}

// Load all referenced files
async function loadRef(ref) {
  const text = await readFile(join(root, "data", ref), "utf8");
  return JSON.parse(text);
}

// Collect all IDs for uniqueness check
const allIds = new Set();
function checkUniqueId(id, source) {
  if (allIds.has(id)) {
    fail(`Duplicate ID: ${id} (in ${source})`);
  }
  allIds.add(id);
}

// Load audiences
const audiences = new Map();
console.log("\nValidating audiences...");
for (const { ref } of index.audiences) {
  const aud = await loadRef(ref);
  if (!validateAudience(aud)) {
    for (const e of validateAudience.errors) fail(`${ref}: ${e.instancePath} ${e.message}`);
  }
  checkUniqueId(aud.id, ref);
  audiences.set(aud.id, aud);
  console.log(`  OK: ${aud.id}`);
}

// Load evidence manifest
console.log("\nValidating evidence manifest...");
const evidenceText = await readFile(join(root, "manifests/evidence.manifest.json"), "utf8");
const evidenceManifest = JSON.parse(evidenceText);
const evidenceIds = new Set();
for (const entry of evidenceManifest.entries) {
  if (!validateEvidence(entry)) {
    for (const e of validateEvidence.errors)
      fail(`evidence ${entry.id}: ${e.instancePath} ${e.message}`);
  }
  checkUniqueId(entry.id, "evidence.manifest.json");
  evidenceIds.add(entry.id);
  console.log(`  OK: ${entry.id}`);
}

// Load tools
const tools = new Map();
console.log("\nValidating tools...");
for (const { ref } of index.tools) {
  const tool = await loadRef(ref);
  if (!validateTool(tool)) {
    for (const e of validateTool.errors) fail(`${ref}: ${e.instancePath} ${e.message}`);
  }
  checkUniqueId(tool.id, ref);
  tools.set(tool.id, tool);

  // Collect claim and message IDs
  const claimIds = new Set();
  for (const claim of tool.claims) {
    checkUniqueId(claim.id, ref);
    claimIds.add(claim.id);

    // Check evidenceRefs exist in manifest
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

  // Check message claimRefs resolve to tool's claims
  for (const msg of tool.messages) {
    checkUniqueId(msg.id, ref);
    for (const claimRef of msg.claimRefs) {
      if (!claimIds.has(claimRef)) {
        fail(
          `${ref}: message ${msg.id} references claim ${claimRef} which is not in this tool's claims`,
        );
      }
    }
  }

  // Check audienceRefs resolve
  for (const audRef of tool.audienceRefs) {
    if (!audiences.has(audRef)) {
      fail(`${ref}: audienceRef ${audRef} does not exist`);
    }
  }

  console.log(`  OK: ${tool.id} (${tool.claims.length} claims, ${tool.messages.length} messages)`);
}

// Load campaigns
console.log("\nValidating campaigns...");
for (const { ref } of index.campaigns) {
  const campaign = await loadRef(ref);
  if (!validateCampaign(campaign)) {
    for (const e of validateCampaign.errors) fail(`${ref}: ${e.instancePath} ${e.message}`);
  }
  checkUniqueId(campaign.id, ref);

  // Check toolRef resolves
  if (!tools.has(campaign.toolRef)) {
    fail(`${ref}: toolRef ${campaign.toolRef} does not exist`);
  }

  // Check audienceRefs resolve
  for (const audRef of campaign.audienceRefs) {
    if (!audiences.has(audRef)) {
      fail(`${ref}: audienceRef ${audRef} does not exist`);
    }
  }

  // Check messageRefs resolve to tool's messages
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

// Summary
console.log(`\n${allIds.size} unique IDs checked.`);
if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) found.`);
  process.exit(1);
} else {
  console.log("All validations passed.");
}
