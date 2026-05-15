#!/usr/bin/env node
/**
 * graduation-report.mjs — Surface aspirational-claim graduation status.
 *
 * Usage:
 *   node marketing/scripts/graduation-report.mjs                 # human table
 *   node marketing/scripts/graduation-report.mjs --json          # structured JSON
 *   node marketing/scripts/graduation-report.mjs --root <path>   # alternate tree
 *   node marketing/scripts/graduation-report.mjs --help
 *   node marketing/scripts/graduation-report.mjs --version
 *
 * Reads every tool in the index, walks each tool's claims[], and for every
 * claim with `status: "aspirational"` consults `claim.graduation.targetDate`
 * to bucket it as:
 *
 *   - overdue       targetDate is strictly before today
 *   - due-this-month targetDate is within the next 30 days (inclusive)
 *   - on-track       targetDate is more than 30 days out
 *   - untracked      claim is aspirational but has no graduation block at all
 *
 * Exit codes:
 *   0   No overdue claims.
 *   1   At least one overdue claim. (Suitable for a CI gate.)
 *
 * The "today" baseline is sampled at script start (process.uptime is irrelevant;
 * the value is just `new Date()`). The script does NOT mutate any data; it is
 * read-only by design so it is safe to run on every CI run + locally.
 *
 * Implementation notes:
 *   - Mirrors the gen-lock / validate UX surface (--help / --version / --json /
 *     --root + MCPT_MARKETING_ROOT, error envelope on uncaught exceptions).
 *     F-SCRIPTS-B-001 / -004 / -012 / -013.
 *   - The human table is intentionally simple ASCII columns. A future variant
 *     could colorize the Status column, but plain ASCII renders identically in
 *     CI logs, terminals, and copy-paste-into-issue body — preferred for an
 *     accountability report.
 *   - Graduation status is computed against UTC midnight of today to avoid
 *     timezone-induced flapping (a claim should not flip overdue/due based on
 *     who runs the report).
 *
 * Cross-domain note: the audit suggested a non-blocking CI step that runs this
 * weekly and opens an issue when N>0 overdue. That CI wiring is owned by the
 * ci-tooling agent in this swarm; the script is built so a CI step only needs
 * `npm run graduation -- --json` and to inspect the JSON `summary.overdue`
 * field (or just check exit code).
 */

import { join } from "node:path";
import { INDEX_PATH, getScriptVersion, loadJson, parseArgs, resolveRoots } from "./_paths.mjs";

const HELP_TEXT = `Usage: node graduation-report.mjs [options]

Walks every tool's aspirational claims and reports their graduation status.

Options:
  --json                    Emit a single JSON object on stdout (machine-readable).
                            Implies that no human banner / table is printed.
  --root <path>             Use an alternate marketing/ root (overrides
                            MCPT_MARKETING_ROOT and the script-relative default).
  --help, -h                Print this help and exit 0.
  --version                 Print the script version and exit 0.

Environment:
  MCPT_MARKETING_ROOT       Same as --root.

Categorization:
  overdue          targetDate is strictly before today.
  due-this-month   targetDate is within the next 30 days (inclusive).
  on-track         targetDate is more than 30 days out.
  untracked        claim is aspirational but has no graduation block at all.

Exit codes:
  0   No overdue claims.
  1   At least one overdue claim.

Read-only: the script never mutates any file under marketing/.
`;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Truncate a Date to UTC midnight. Reduces accidental flapping when the
 * report is run from different timezones (a claim with targetDate=2026-09-15
 * should not be 'overdue' for a US runner and 'on-track' for a JP runner).
 */
function utcMidnight(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Parse a YYYY-MM-DD date string into a UTC Date at midnight. Returns null on
 * an invalid string so the caller can flag the claim instead of crashing.
 */
function parseTargetDate(s) {
  if (typeof s !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  // Sanity-check (Date constructor accepts e.g. month=13 by rolling).
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) {
    return null;
  }
  return dt;
}

/**
 * Bucket a claim into one of the four categories. Returns the category +
 * a reason string when the input is malformed (e.g. invalid targetDate).
 */
function categorize(claim, todayUtc) {
  if (claim.status !== "aspirational") return null; // only aspirational claims are tracked
  const grad = claim.graduation;
  if (!grad || !grad.targetDate) {
    return { category: "untracked", targetDate: null, reason: "no graduation block" };
  }
  const dt = parseTargetDate(grad.targetDate);
  if (!dt) {
    // An untracked-with-malformed-date is more useful as 'untracked' with a
    // reason than as a hard error; the contributor still sees the claim and
    // a hint to fix the date format.
    return {
      category: "untracked",
      targetDate: grad.targetDate,
      reason: `invalid targetDate ${JSON.stringify(grad.targetDate)} (expected YYYY-MM-DD)`,
    };
  }
  const deltaDays = Math.floor((dt.getTime() - todayUtc.getTime()) / DAY_MS);
  if (deltaDays < 0) {
    return { category: "overdue", targetDate: grad.targetDate, deltaDays };
  }
  if (deltaDays <= 30) {
    return { category: "due-this-month", targetDate: grad.targetDate, deltaDays };
  }
  return { category: "on-track", targetDate: grad.targetDate, deltaDays };
}

/**
 * Pad a string to a target length for column alignment in the human table.
 * Truncates with an ellipsis when the input exceeds `width`.
 */
function pad(s, width) {
  const str = s ?? "";
  if (str.length >= width) {
    if (width <= 1) return str.slice(0, width);
    return str.slice(0, width - 1) + "…";
  }
  return str + " ".repeat(width - str.length);
}

function statusLabel(category) {
  // Human-friendly labels (slightly narrower than the JSON key for table fit).
  switch (category) {
    case "overdue":
      return "overdue";
    case "due-this-month":
      return "due soon";
    case "on-track":
      return "on track";
    case "untracked":
      return "untracked";
    default:
      return category;
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (flags.version) {
    const v = await getScriptVersion();
    process.stdout.write(`graduation-report.mjs ${v}\n`);
    process.exit(0);
  }

  const jsonMode = flags.json === true;

  const { repoRoot: repoRootAbs } = resolveRoots({
    root: typeof flags.root === "string" ? flags.root : undefined,
  });

  const todayUtc = utcMidnight(new Date());

  // Load the index, then each tool. Defensive: a malformed index is reported
  // via the error envelope rather than crashing.
  const index = await loadJson(INDEX_PATH, "marketing index", repoRootAbs);
  if (!Array.isArray(index?.tools)) {
    throw new Error("marketing.index.json: tools[] is missing or not an array");
  }

  /** @type {Array<{tool:string,claim:string,category:string,targetDate:string|null,blockedBy:string|null,owner:string|null,deltaDays:number|null,reason:string|null}>} */
  const rows = [];

  for (const entry of index.tools) {
    const ref = entry?.ref;
    if (typeof ref !== "string") continue;
    // Use loadJson under marketing/data/<ref> so we share the path validation
    // policy with the other scripts (the index ref pattern is checked by the
    // schema; we trust it here since the validator ensures it).
    const tool = await loadJson(`marketing/data/${ref}`, `tool ${ref}`, repoRootAbs);
    if (!Array.isArray(tool?.claims)) continue;
    for (const claim of tool.claims) {
      const bucket = categorize(claim, todayUtc);
      if (!bucket) continue;
      rows.push({
        tool: tool.id || ref,
        claim: claim.id || "(no-id)",
        category: bucket.category,
        targetDate: bucket.targetDate ?? null,
        blockedBy: claim.graduation?.blockedBy ?? null,
        owner: claim.graduation?.owner ?? null,
        deltaDays: bucket.deltaDays ?? null,
        reason: bucket.reason ?? null,
      });
    }
  }

  // Tally counts. The presence of any 'overdue' row drives exit code 1.
  const counts = {
    overdue: 0,
    "due-this-month": 0,
    "on-track": 0,
    untracked: 0,
  };
  for (const r of rows) counts[r.category]++;
  const exitCode = counts.overdue > 0 ? 1 : 0;

  if (jsonMode) {
    const payload = {
      ok: exitCode === 0,
      version: await getScriptVersion(),
      generatedAtUtc: todayUtc.toISOString(),
      summary: counts,
      rows,
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    process.exit(exitCode);
  }

  // Human table. Sort by category (overdue first, then due-this-month, then
  // on-track, then untracked), then by tool, then by claim, so the most
  // urgent rows are at the top and the order is stable run-to-run.
  const order = { overdue: 0, "due-this-month": 1, "on-track": 2, untracked: 3 };
  rows.sort((a, b) => {
    const da = order[a.category] - order[b.category];
    if (da !== 0) return da;
    const dt = a.tool.localeCompare(b.tool);
    if (dt !== 0) return dt;
    return a.claim.localeCompare(b.claim);
  });

  const banner = `Graduation report (today UTC: ${todayUtc.toISOString().slice(0, 10)})`;
  console.log(banner);
  console.log("=".repeat(banner.length));
  console.log("");
  console.log(
    `${pad("Tool", 24)}${pad("Claim", 44)}${pad("Status", 12)}${pad("Target", 12)}${pad("BlockedBy", 30)}`,
  );
  console.log("-".repeat(122));
  if (rows.length === 0) {
    console.log("(no aspirational claims found — nothing to graduate)");
  } else {
    for (const r of rows) {
      console.log(
        `${pad(r.tool, 24)}${pad(r.claim, 44)}${pad(statusLabel(r.category), 12)}${pad(r.targetDate || "(none)", 12)}${pad(r.blockedBy || "", 30)}`,
      );
    }
  }
  console.log("");
  console.log(
    `Summary: overdue=${counts.overdue}, due-this-month=${counts["due-this-month"]}, on-track=${counts["on-track"]}, untracked=${counts.untracked}`,
  );
  if (exitCode !== 0) {
    console.error(`\n${counts.overdue} overdue claim(s). Exit 1.`);
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`graduation-report.mjs failed: ${err.message}`);
  process.exit(1);
});
