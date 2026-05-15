#!/usr/bin/env node
/**
 * new-tool.mjs — Scaffold a new tool entry under marketing/data/tools/.
 *
 * Usage:
 *   node marketing/scripts/new-tool.mjs <tool-id>
 *   node marketing/scripts/new-tool.mjs <tool-id> --root <path>
 *   node marketing/scripts/new-tool.mjs --help
 *   node marketing/scripts/new-tool.mjs --version
 *
 * <tool-id> is the namespace suffix used in the canonical id `tool.<tool-id>`
 * (e.g. `shipcheck`, `zip-meta-map`). Must be lowercase kebab-case and match
 * `^[a-z][a-z0-9-]*$` (the same shape the schema's toolId regex requires after
 * the `tool.` prefix is stripped).
 *
 * Behavior:
 *   - Creates `marketing/data/tools/<tool-id>.json` with a populated boilerplate
 *     template covering every required schema field. All claims default to
 *     `status: "aspirational"` with placeholder text and a graduation block so
 *     the new tool's claims are immediately visible to the graduation report.
 *   - Adds 1 example message per canonical channel (web, readme, hn, x, linkedin).
 *   - Adds a placeholder press.boilerplate (including forbiddenPhrases the
 *     project conventionally bans) and a placeholder targeting block.
 *   - Inserts the new entry into `marketing/data/marketing.index.json` (sorted
 *     alphabetically by ref).
 *   - Refuses to overwrite an existing file. The user must delete it first.
 *
 * Inline guidance:
 *   - The schema enforces `additionalProperties: false` for tool documents, so
 *     `_comment` keys cannot be embedded in the JSON itself. Instead, this
 *     scaffold packs guidance into the `notes` fields of each claim/message
 *     and into the placeholder text. The scaffolder also prints a brief
 *     "Next steps" block reminding the user to edit, validate, and lock.
 *
 * Implementation notes:
 *   - Parallel to gen-lock.mjs / validate.mjs in argv handling, error envelope,
 *     and atomic-write semantics. F-SCRIPTS-B-001 / -005 / -012 / -013.
 *   - Writes the new file ATOMICALLY (tmp + rename) so a Ctrl-C between the
 *     two writes (file + index) does not leave a half-written tool file on disk.
 *   - Updates the index AFTER the file write succeeds. If the index update
 *     fails, the new tool file is rolled back so the tree stays consistent.
 */

import { randomUUID } from "node:crypto";
import { access, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { INDEX_PATH, getScriptVersion, loadJson, parseArgs, resolveRoots } from "./_paths.mjs";

const HELP_TEXT = `Usage: node new-tool.mjs <tool-id> [options]

Scaffold a new tool entry under marketing/data/tools/<tool-id>.json and
register it in marketing/data/marketing.index.json.

Arguments:
  <tool-id>                 Lowercase kebab-case suffix used in tool.<tool-id>
                            (e.g. 'shipcheck', 'zip-meta-map'). Must match
                            ^[a-z][a-z0-9-]*$ and contain at least one letter.

Options:
  --root <path>             Use an alternate marketing/ root (overrides
                            MCPT_MARKETING_ROOT and the script-relative default).
  --help, -h                Print this help and exit 0.
  --version                 Print the script version and exit 0.

Environment:
  MCPT_MARKETING_ROOT       Same as --root.

Behavior:
  - Refuses to overwrite an existing tools/<tool-id>.json. Delete the file
    first if you intend a clean re-scaffold.
  - The generated record sets every claim to status='aspirational' with a
    graduation block so the graduation report sees the new tool immediately.
  - The tool's index entry is inserted alphabetically by ref.

Next steps after scaffolding:
  1. Edit marketing/data/tools/<tool-id>.json — replace placeholder copy
     with real positioning, claims, messages, and press boilerplate.
  2. Run 'npm run validate' to confirm the new file is well-formed.
  3. Run 'npm run lock' to refresh marketing/manifests/marketing.lock.json.
`;

const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Atomic write: stage to a uuid-suffixed tmp file, then rename into place.
 * Mirrors gen-lock.mjs's atomicWrite for the same reasons (torn-write
 * prevention + cleanup on rename failure).
 */
async function atomicWrite(finalAbs, contents) {
  const tmpAbs = `${finalAbs}.tmp.${randomUUID()}`;
  await writeFile(tmpAbs, contents, "utf8");
  try {
    await rename(tmpAbs, finalAbs);
  } catch (err) {
    try {
      await unlink(tmpAbs);
    } catch {
      // best-effort
    }
    throw new Error(`Atomic rename failed: ${err.message} (tmp=${tmpAbs}, final=${finalAbs})`);
  }
}

/**
 * Build a populated tool boilerplate. Every field that the schema requires is
 * present; every field is placeholder copy that the contributor is expected
 * to replace before running validate. Claims default to aspirational with a
 * graduation block roughly 30 days out so they show on the graduation report
 * as 'due this month' and prompt action.
 */
function buildBoilerplate(toolId) {
  const today = new Date();
  // 60-day default target so new claims are 'on track' but visible.
  const target = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const targetDate = target.toISOString().slice(0, 10);

  const id = `tool.${toolId}`;
  // Use a syntactically-valid placeholder audience id so the file passes the
  // schema regex. Validation will still fail at the I4 (audienceRefs resolve)
  // check until the contributor edits this to a real audience id, which is
  // the correct signal: "the schema accepts your file but the project does not
  // know about that audience yet."
  const aud = "aud.placeholder-edit-me";
  const claimBase = `claim.${toolId}`;
  const msgBase = `msg.${toolId}`;

  return {
    schemaVersion: "1.0.0",
    id,
    name: toolId,
    positioning: {
      oneLiner: `One sentence describing ${toolId}. (PLACEHOLDER — edit before validate.)`,
      valueProps: [
        `First key value proposition for ${toolId}. (PLACEHOLDER)`,
        `Second key value proposition for ${toolId}. (PLACEHOLDER)`,
      ],
    },
    audienceRefs: [aud],
    claims: [
      {
        id: `${claimBase}.placeholder-property`,
        status: "aspirational",
        statement: `${toolId} satisfies a falsifiable property. (PLACEHOLDER — replace with a real claim and add evidenceRefs once status='proven'.)`,
        graduation: {
          targetDate,
          blockedBy: "Initial scaffold; replace this placeholder claim.",
          owner: "mcp-tool-shop",
          criteria:
            "Replace this claim with a real falsifiable property and back it with evidence.",
        },
        notes:
          "Inline guidance: every claim must trace to evidence before status can become 'proven'. While aspirational, fill in graduation.targetDate / blockedBy / owner / criteria so the graduation report can surface this claim.",
      },
    ],
    antiClaims: [
      {
        statement: `Does NOT do <thing>. (PLACEHOLDER — list a real anti-claim so consumers know the boundary.)`,
      },
    ],
    messages: [
      {
        id: `${msgBase}.web-blurb`,
        channel: "web",
        tone: "pragmatic",
        text: `Web blurb for ${toolId}: one or two sentences pitched at a casual visitor. (PLACEHOLDER — under 280 chars.)`,
        claimRefs: [`${claimBase}.placeholder-property`],
        constraints: { maxChars: 280 },
        notes:
          "Inline guidance: every message must reference at least one claim from this tool's claims[]. Honor the channel-specific maxChars in constraints.",
      },
      {
        id: `${msgBase}.readme-snippet`,
        channel: "readme",
        tone: "technical",
        text: `README snippet for ${toolId}: technical prose suitable for a project README. (PLACEHOLDER.)`,
        claimRefs: [`${claimBase}.placeholder-property`],
      },
      {
        id: `${msgBase}.hn-post`,
        channel: "hn",
        tone: "technical",
        text: `Show HN draft for ${toolId}: opening lines for an HN post. (PLACEHOLDER — under 300 chars; HN title goes elsewhere.)`,
        claimRefs: [`${claimBase}.placeholder-property`],
        constraints: { maxChars: 300, notes: "HN title should be separate and under 80 chars." },
      },
      {
        id: `${msgBase}.x-post`,
        channel: "x",
        tone: "pragmatic",
        text: `X/Twitter post for ${toolId}: pragmatic single-tweet pitch. (PLACEHOLDER — under 280 chars.)`,
        claimRefs: [`${claimBase}.placeholder-property`],
        constraints: { maxChars: 280 },
      },
      {
        id: `${msgBase}.linkedin-post`,
        channel: "linkedin",
        tone: "executive",
        text: `LinkedIn post for ${toolId}: executive-tone post for a professional audience. (PLACEHOLDER — under 700 chars.)`,
        claimRefs: [`${claimBase}.placeholder-property`],
        constraints: { maxChars: 700 },
      },
    ],
    press: {
      boilerplate: {
        projectDescription: `Project description for ${toolId}: extended press-suitable description, several sentences. (PLACEHOLDER — replace with real prose before any outreach.)`,
        founderBio:
          "Built by the mcp-tool-shop team — a small group focused on deterministic developer tooling. (PLACEHOLDER — edit if attribution differs.)",
        preferredNouns: ["tool", "CLI"],
        forbiddenPhrases: [
          "AI-powered",
          "revolutionary",
          "game-changer",
          "magic",
          "next-generation",
        ],
      },
      contacts: [
        {
          method: "github-issue",
          value: "https://github.com/mcp-tool-shop/mcpt-marketing/issues",
          label: "GitHub Issues (replace with the tool's own issue tracker once public)",
        },
      ],
      quotes: [],
      comparables: [],
      partnerOffers: [],
    },
    targeting: {
      keywords: ["PLACEHOLDER-keyword"],
      topics: ["devtools"],
      languages: ["TypeScript"],
      exclusions: ["mcp-tool-shop-org", "mcp-tool-shop"],
      seedRepos: [],
    },
  };
}

/**
 * Insert a new ref into the tools[] array of the index, preserving alpha order
 * by ref. Mutates `index` in place. Returns true if inserted; false if the ref
 * was already present.
 */
function insertToolRef(index, newRef) {
  if (!Array.isArray(index.tools)) {
    throw new Error("marketing.index.json: tools[] is missing or not an array");
  }
  for (const entry of index.tools) {
    if (entry?.ref === newRef) return false;
  }
  index.tools.push({ ref: newRef });
  index.tools.sort((a, b) => a.ref.localeCompare(b.ref));
  return true;
}

async function fileExists(abs) {
  try {
    await access(abs);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));

  if (flags.help || flags.h) {
    process.stdout.write(HELP_TEXT);
    process.exit(0);
  }
  if (flags.version) {
    const v = await getScriptVersion();
    process.stdout.write(`new-tool.mjs ${v}\n`);
    process.exit(0);
  }

  const toolId = positional[0];
  if (!toolId) {
    console.error("Usage: node new-tool.mjs <tool-id>  (run with --help for full options)");
    process.exit(1);
  }
  if (!TOOL_ID_PATTERN.test(toolId)) {
    console.error(
      `new-tool.mjs: invalid <tool-id> ${JSON.stringify(toolId)}. Must match ${TOOL_ID_PATTERN} ` +
        `(lowercase kebab-case, starts with a letter).`,
    );
    process.exit(1);
  }

  const { repoRoot: repoRootAbs } = resolveRoots({
    root: typeof flags.root === "string" ? flags.root : undefined,
  });

  const relRef = `tools/${toolId}.json`;
  const newFileAbs = join(repoRootAbs, "marketing/data", relRef);
  const indexAbs = join(repoRootAbs, INDEX_PATH);

  // Refuse to clobber an existing file. The contributor must explicitly
  // delete it to re-scaffold; this prevents a typo'd tool-id from silently
  // wiping out hand-authored content.
  if (await fileExists(newFileAbs)) {
    throw new Error(
      `Refusing to overwrite existing file: ${newFileAbs}. ` +
        `Delete it first if you intend to re-scaffold.`,
    );
  }

  // Build + write the boilerplate atomically.
  const boilerplate = buildBoilerplate(toolId);
  const fileJson = JSON.stringify(boilerplate, null, 2) + "\n";
  await atomicWrite(newFileAbs, fileJson);

  // Update the index. If this fails, roll back the file write so the tree
  // does not end up with an orphaned tool file the index does not know about.
  try {
    const index = await loadJson(INDEX_PATH, "marketing index", repoRootAbs);
    const inserted = insertToolRef(index, relRef);
    if (!inserted) {
      // Already present — surprising since we just created the file, but treat
      // it as benign and proceed without re-writing the index.
      console.warn(`new-tool.mjs: tools[] already contained ${relRef}; index unchanged.`);
    } else {
      const indexJson = JSON.stringify(index, null, 2) + "\n";
      await atomicWrite(indexAbs, indexJson);
    }
  } catch (err) {
    // Roll back the file write so the tree stays consistent.
    try {
      await unlink(newFileAbs);
    } catch {
      // best-effort
    }
    throw new Error(
      `Failed to update marketing.index.json (rolled back ${newFileAbs}): ${err.message}`,
    );
  }

  // Print success + next-steps to stdout (no JSON output mode for this script;
  // the natural consumer is a human, and a future caller can grep for the
  // "Next steps" line if needed).
  console.log(`Created marketing/data/${relRef}`);
  console.log(`Updated ${INDEX_PATH} (added ${relRef})`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Edit marketing/data/${relRef} — replace placeholder copy with real values.`);
  console.log("  2. Run 'npm run validate' to confirm the new file is well-formed.");
  console.log("  3. Run 'npm run lock' to refresh marketing/manifests/marketing.lock.json.");
}

main().catch((err) => {
  console.error(`new-tool.mjs failed: ${err.message}`);
  process.exit(1);
});
