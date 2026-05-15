#!/usr/bin/env node
/**
 * examples/consume.mjs — Reference consumer for the MarketIR data set.
 *
 * THIS IS A REFERENCE EXAMPLE. A real downstream consumer (the public
 * mcptoolshop.com site, a Slack notifier, an external press-page generator)
 * should use a stable URL (e.g. raw.githubusercontent.com/<tag>/<path>) instead
 * of relative filesystem paths, cache responses, and validate against the
 * published JSON Schema rather than trusting field shape. This example assumes
 * a local checkout and prints to stdout for demonstration.
 *
 * Walks through:
 *   1. Read marketing/manifests/marketing.lock.json (the entry point).
 *   2. Verify lockfile schemaVersion is compatible (warn if not).
 *   3. For each entry in lock.files[], read the file, recompute sha256, compare
 *      to the lockfile entry (the integrity check that turns "trust the
 *      lockfile" into "verify the lockfile").
 *   4. Walk marketing/data/marketing.index.json to discover tools / audiences /
 *      campaigns.
 *   5. For each tool, print: name, oneLiner, status counts, the first 2
 *      messages, and the press boilerplate snippet.
 *
 * Usage:
 *   node examples/consume.mjs                       # human-readable output
 *   node examples/consume.mjs --json                # structured JSON to stdout
 *   node examples/consume.mjs --root <path>         # alternate marketing/ tree
 *   node examples/consume.mjs --help
 *   node examples/consume.mjs --version
 *
 * Defaults: when invoked with no --root, walks one level up from this file
 * (so `node examples/consume.mjs` from the repo root works as expected).
 *
 * Exit codes:
 *   0 — Walked + verified everything successfully.
 *   1 — Integrity failure (sha256 mismatch / unreadable file / schema mismatch).
 */

import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// examples/consume.mjs -> repo root (one level up).
const DEFAULT_REPO_ROOT = join(__dirname, "..");

// We intentionally do NOT import from marketing/scripts/_paths.mjs. A real
// downstream consumer would not have the producer's helper module on its
// classpath; the example should stand on its own with only Node core APIs.

const SUPPORTED_LOCK_SCHEMA_MAJOR = "1";

const HELP_TEXT = `Usage: node examples/consume.mjs [options]

Reference consumer that walks the MarketIR data set, verifies the lockfile
integrity, and prints a human-readable summary of every tool.

Options:
  --json                  Emit a single JSON object on stdout instead of human
                          text. Implies that no banner / progress lines are printed.
  --root <path>           Path to the repo root containing the marketing/
                          subtree. Defaults to one level up from this file.
  --help, -h              Print this help and exit 0.
  --version               Print the script version and exit 0.

Exit codes:
  0   Walked + verified everything successfully.
  1   Integrity failure (sha256 mismatch / unreadable file / schema mismatch).

This script is documentation that runs. A production consumer should:
  - Use a stable URL (raw.githubusercontent.com/<tag>/<path>) instead of a
    local checkout so cache + integrity guarantees are well-defined.
  - Validate every fetched document against the published JSON Schema.
  - Cache aggressively — the lockfile + every IR file is content-addressed,
    so a sha256 match means a byte-for-byte cache hit.
`;

const VERSION = "1.0.0";

// Tiny inline argv parser — we mirror parseArgs() from _paths.mjs so the
// example does not depend on producer-side modules.
function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (a.startsWith("-")) {
      // single-letter flags
      flags[a.slice(1)] = true;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function loadJsonAt(abs) {
  let text;
  try {
    text = await readFile(abs, "utf8");
  } catch (err) {
    throw new Error(`Failed to read ${abs}: ${err.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${abs} as JSON: ${err.message}`);
  }
}

/**
 * For each entry in the lockfile, recompute sha256 + bytes from disk and
 * compare against the lockfile-recorded values. Returns { ok, mismatches }
 * where mismatches[] contains one entry per failure (path + reason).
 *
 * This is the load-bearing check: the lockfile is meaningful only if a
 * consumer actually re-verifies it. Skipping this step turns the lockfile
 * from "tamper-evident" into "polite suggestion."
 */
async function verifyLockfile(repoRootAbs, lock) {
  const mismatches = [];
  for (const entry of lock.files || []) {
    const abs = join(repoRootAbs, entry.path);
    let buf;
    try {
      buf = await readFile(abs);
    } catch (err) {
      mismatches.push({
        path: entry.path,
        reason: `read failed: ${err.message}`,
      });
      continue;
    }
    const actualSha = createHash("sha256").update(buf).digest("hex");
    const actualBytes = buf.length;
    if (actualSha !== entry.sha256) {
      mismatches.push({
        path: entry.path,
        reason: `sha256 mismatch (expected ${entry.sha256}, actual ${actualSha})`,
      });
    } else if (actualBytes !== entry.bytes) {
      mismatches.push({
        path: entry.path,
        reason: `bytes mismatch (expected ${entry.bytes}, actual ${actualBytes})`,
      });
    }
  }
  return { ok: mismatches.length === 0, mismatches, verified: lock.files?.length || 0 };
}

/**
 * Count claims by status (proven / aspirational / deprecated).
 */
function statusCounts(claims) {
  const counts = { proven: 0, aspirational: 0, deprecated: 0 };
  for (const c of claims || []) {
    if (counts[c.status] !== undefined) counts[c.status]++;
  }
  return counts;
}

/**
 * Print a human-readable per-tool summary. Mirrors what the public site
 * landing page would show as a tool card.
 */
function printToolSummary(tool) {
  const counts = statusCounts(tool.claims);
  console.log(`\n  Tool: ${tool.name} (${tool.id})`);
  console.log(`    OneLiner: ${tool.positioning?.oneLiner || "(missing)"}`);
  console.log(
    `    Status counts: proven=${counts.proven}, aspirational=${counts.aspirational}, deprecated=${counts.deprecated}`,
  );
  // First 2 messages.
  if (Array.isArray(tool.messages) && tool.messages.length > 0) {
    console.log(`    First messages:`);
    for (const msg of tool.messages.slice(0, 2)) {
      const text = (msg.text || "").slice(0, 120) + (msg.text?.length > 120 ? "..." : "");
      console.log(`      [${msg.channel}] ${text}`);
    }
  }
  // Press boilerplate snippet.
  const pressDesc = tool.press?.boilerplate?.projectDescription;
  if (pressDesc) {
    const snippet = pressDesc.slice(0, 200) + (pressDesc.length > 200 ? "..." : "");
    console.log(`    Press boilerplate: ${snippet}`);
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (flags.version) {
    process.stdout.write(`examples/consume.mjs ${VERSION}\n`);
    process.exit(0);
  }

  const jsonMode = flags.json === true;

  // Resolve the repo root. --root > script-relative default.
  let repoRootAbs;
  if (typeof flags.root === "string") {
    repoRootAbs = isAbsolute(flags.root) ? flags.root : resolve(process.cwd(), flags.root);
  } else {
    repoRootAbs = DEFAULT_REPO_ROOT;
  }

  // Sanity: confirm marketing/ exists at the resolved root so a misconfigured
  // --root produces a clearer error than ENOENT-on-lockfile.
  try {
    await stat(join(repoRootAbs, "marketing"));
  } catch {
    throw new Error(
      `No marketing/ directory found at ${repoRootAbs}. Pass --root <path> if running from a non-default location.`,
    );
  }

  if (!jsonMode) {
    console.log(`MarketIR consumer example (root: ${repoRootAbs})`);
  }

  // Step 1: read the lockfile.
  const lockAbs = join(repoRootAbs, "marketing/manifests/marketing.lock.json");
  const lock = await loadJsonAt(lockAbs);

  // Step 2: schema-version compatibility check.
  const lockMajor = (lock.schemaVersion || "0").split(".")[0];
  const lockSchemaWarn =
    lockMajor !== SUPPORTED_LOCK_SCHEMA_MAJOR
      ? `lockfile schemaVersion ${JSON.stringify(lock.schemaVersion)} differs in MAJOR from supported ${SUPPORTED_LOCK_SCHEMA_MAJOR}.x — proceeding cautiously`
      : null;
  if (lockSchemaWarn && !jsonMode) {
    console.warn(`  WARN: ${lockSchemaWarn}`);
  }

  // Step 3: integrity check — recompute sha256 for every locked file.
  const verify = await verifyLockfile(repoRootAbs, lock);
  if (!jsonMode) {
    if (verify.ok) {
      console.log(`  OK: lockfile integrity verified (${verify.verified} files)`);
    } else {
      console.error(`  FAIL: ${verify.mismatches.length} integrity mismatch(es):`);
      for (const m of verify.mismatches) console.error(`    - ${m.path}: ${m.reason}`);
    }
  }

  // Step 4: walk the index.
  const indexAbs = join(repoRootAbs, "marketing/data/marketing.index.json");
  const index = await loadJsonAt(indexAbs);
  const audienceCount = (index.audiences || []).length;
  const toolCount = (index.tools || []).length;
  const campaignCount = (index.campaigns || []).length;
  if (!jsonMode) {
    console.log(`\n  Index summary:`);
    console.log(`    Audiences: ${audienceCount}`);
    console.log(`    Tools: ${toolCount}`);
    console.log(`    Campaigns: ${campaignCount}`);
  }

  // Step 5: per-tool walk.
  const toolSummaries = [];
  for (const entry of index.tools || []) {
    const ref = entry.ref;
    if (typeof ref !== "string") continue;
    const toolAbs = join(repoRootAbs, "marketing/data", ref);
    const tool = await loadJsonAt(toolAbs);
    if (!jsonMode) printToolSummary(tool);
    toolSummaries.push({
      ref,
      id: tool.id,
      name: tool.name,
      oneLiner: tool.positioning?.oneLiner || null,
      statusCounts: statusCounts(tool.claims),
      firstMessages: (tool.messages || []).slice(0, 2).map((m) => ({
        id: m.id,
        channel: m.channel,
        text: m.text,
      })),
      pressBoilerplate: tool.press?.boilerplate?.projectDescription || null,
    });
  }

  // Final exit decision: integrity failures are fatal.
  const exitCode = verify.ok ? 0 : 1;

  if (jsonMode) {
    const payload = {
      ok: verify.ok,
      version: VERSION,
      lock: {
        schemaVersion: lock.schemaVersion,
        compatibilityWarning: lockSchemaWarn,
        verifiedFileCount: verify.verified,
        mismatches: verify.mismatches,
      },
      index: {
        audiences: audienceCount,
        tools: toolCount,
        campaigns: campaignCount,
      },
      tools: toolSummaries,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    process.exit(exitCode);
  }

  if (exitCode !== 0) {
    console.error(`\nConsumer walk completed with ${verify.mismatches.length} integrity error(s).`);
  } else {
    console.log("\n  All integrity checks passed.");
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`examples/consume.mjs failed: ${err.message}`);
  process.exit(1);
});
