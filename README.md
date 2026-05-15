# mcpt-marketing

[![CI](https://github.com/mcp-tool-shop/mcpt-marketing/actions/workflows/ci.yml/badge.svg)](https://github.com/mcp-tool-shop/mcpt-marketing/actions/workflows/ci.yml)
[![CodeQL](https://github.com/mcp-tool-shop/mcpt-marketing/actions/workflows/codeql.yml/badge.svg)](https://github.com/mcp-tool-shop/mcpt-marketing/actions/workflows/codeql.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node ≥20](https://img.shields.io/badge/node-%E2%89%A520-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

Deterministic marketing infrastructure for MCPT tools: **falsifiable claims**, **hash-verified evidence**, and **channel-ready messages** that stay traceable as the product evolves.

This repo defines **MarketIR** — a small, versioned "marketing intermediate representation" designed to be consumed by generators and the public site ([mcptoolshop.com](https://mcptoolshop.com)) without turning marketing into a manual, fragile process.

---

## What this is (and isn't)

**This is:**

- A structured source of truth for product messaging
- Claims that are explicitly labeled **proven** vs **aspirational**
- Evidence artifacts with **sha256 hashes + provenance**
- Messages that **must trace back to claims** — no drive-by assertions

**This is not:**

- A blog
- A CMS
- A place for vibes-based copy that can't be tested

---

## Core ideas

| Principle         | What it means                                                        |
| ----------------- | -------------------------------------------------------------------- |
| **Proof-first**   | Proven claims must link to evidence. No evidence, no "proven" badge. |
| **Deterministic** | Content is pinned by a lockfile. Hash drift fails CI.                |
| **Composable**    | Messages are views of claims for different channels and audiences.   |
| **Honest**        | Anti-claims prevent overreach. If a tool can't do something, say so. |

---

## Repository layout

```
marketing/
  schema/           # MarketIR JSON Schema (2020-12, versioned)
  data/
    tools/          # One file per tool (claims, messages, positioning)
    audiences/      # One file per audience (pain points, context)
    campaigns/      # One file per campaign (phases, channel sequences)
    marketing.index.json   # Root index — everything starts here
  evidence/         # Evidence artifacts (screenshots, reports), hash-addressed
  manifests/
    evidence.manifest.json   # Evidence registry with sha256 + provenance
    marketing.lock.json      # Lockfile pinning all files by hash
  scripts/          # validate, hash, gen-lock
test/               # node:test suites (see Testing section for the per-suite breakdown)
```

### Authored vs generated

| Type          | Files                                            | Edited by             |
| ------------- | ------------------------------------------------ | --------------------- |
| **Authored**  | `schema/**`, `data/**`, `evidence.manifest.json` | Humans                |
| **Generated** | `marketing.lock.json`                            | `gen-lock.mjs` script |

Everything must be reachable from `marketing/data/marketing.index.json`. No orphan files.

---

## Determinism contract

### IDs are stable and permanent

IDs follow a namespace pattern and are **never renamed** — deprecate instead.

```
tool.<slug>              → tool.zip-meta-map
aud.<name>               → aud.ci-maintainers
claim.<tool>.<slug>      → claim.zip-meta-map.deterministic-output
ev.<tool>.<slug>.v<n>    → ev.zip-meta-map.build-screenshot.v1
msg.<tool>.<slug>        → msg.zip-meta-map.web-blurb
camp.<tool>.<slug>       → camp.zip-meta-map.launch
```

All IDs must be unique across the entire graph.

### Claim status is explicit

| Status         | Rule                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| `proven`       | Must include at least one `evidenceRef`. CI rejects proven claims with zero evidence. |
| `aspirational` | Allowed, but must be labeled. Upgrade to proven only when evidence is added.          |
| `deprecated`   | Kept for audit trail. Never deleted.                                                  |

### Evidence is hash-verified

Every evidence artifact includes `sha256`, `bytes`, and a `provenance` object (generator, source commit, notes). This makes evidence tamper-evident and reproducible.

### Lockfile is canonical

`marketing.lock.json` pins every included file by hash. CI regenerates the lockfile and fails if it differs from what's committed. Same data, same build, every time.

### Messages trace to claims

Every message references claims via `claimRefs`. If a message asserts something not represented as a claim, validation fails.

### Deterministic serialization

All JSON uses sorted keys, stable array ordering, and trailing newlines. This prevents "same data, different diff" noise.

---

## Local workflow

```bash
npm install

# Format check (Prettier)
npm run fmt:check

# Schema + invariant validation
npm run validate

# Lockfile drift check (CI mode)
npm run lock:check

# Tests (version + structure invariants)
npm test
```

**Typical development loop:**

1. Edit or add files under `marketing/data/**`
2. Add evidence entries to `marketing/manifests/evidence.manifest.json` (and artifacts under `marketing/evidence/` if applicable)
3. Regenerate the lockfile: `node marketing/scripts/gen-lock.mjs`
4. Validate: `npm run validate`
5. Format: `npm run fmt:check` (fix with `npm run fmt`)
6. Run tests: `npm test`

---

## Scripts reference

One-line examples for every script in `package.json`:

| Command                                     | What it does                                                                                                                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run validate`                          | Validate the entire dataset against the schema and structural invariants. No args. Exits non-zero on any failure.                                                                              |
| `npm run lock`                              | Regenerate `marketing/manifests/marketing.lock.json` in place from current data. No args.                                                                                                      |
| `npm run lock:check`                        | Regenerate the lockfile in CI mode and fail if it differs from what's committed. No args. Used by CI.                                                                                          |
| `npm test`                                  | Run the full test suite via the Node built-in test runner.                                                                                                                                     |
| `npm run fmt:check`                         | Verify Prettier formatting across the repo. Exits non-zero if anything would be reformatted.                                                                                                   |
| `npm run fmt`                               | Apply Prettier formatting in place.                                                                                                                                                            |
| `npm run hash -- marketing/evidence/<file>` | Print the sha256 + bytes of one file. Use this when registering a new evidence artifact in `evidence.manifest.json`. The `--` is required so npm forwards the path argument.                   |
| `npm run new-tool -- <id>`                  | Scaffold a new tool entry under `marketing/data/tools/`. Generates the boilerplate JSON file and reminds you to add the index entry. The `--` is required so npm forwards the id argument.     |
| `npm run graduation`                        | Report aspirational claim graduation status (overdue / due this month / on track). Use this to see which aspirational claims are nearing or past their `graduationTarget` date. No args.       |
| `node examples/consume.mjs`                 | Reference consumer that walks the lockfile, verifies every hash, and prints tool summaries. Pass `--json` for machine-readable output. Mirrors what the public site bridge does at build time. |

---

## Troubleshooting

Common failure modes and the one-line fix for each:

| Error                                              | What it means                                                                      | Fix                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `Lockfile is out of date` (or `lock:check failed`) | The committed lockfile no longer matches the current data files.                   | Run `npm run lock` and commit the result.                                                           |
| `Schema validation failed at <path>`               | A data file does not conform to the JSON Schema.                                   | Read the error path; fix the field. The schema lives in `marketing/schema/marketing.schema.json`.   |
| `evidence file not found at <path>`                | The lockfile references a file that doesn't exist on disk (or has a typo'd path).  | Check `marketing/manifests/evidence.manifest.json` — every `path` must exist relative to repo root. |
| `hash mismatch for <file>`                         | The file on disk no longer matches the sha256 recorded in the lockfile/manifest.   | Re-hash with `npm run hash -- <file>` and update the manifest if the change was intentional.        |
| `proven claim has no evidenceRef`                  | A claim is marked `status: "proven"` but lists zero evidence references.           | Either add an `evidenceRef` pointing to a manifest entry, or downgrade the claim to `aspirational`. |
| `forbidden phrase: <X>`                            | A message contains a phrase the validator rejects (see SCORECARD on banned terms). | Rephrase or remove. The forbidden-phrase list is in the validator script.                           |
| `orphan file`                                      | A file under `marketing/data/**` is not reachable from `marketing.index.json`.     | Add it to the index, or delete it.                                                                  |
| `message exceeds max length`                       | A channel message is longer than the per-channel cap declared in the schema.       | Trim the message, or move long-form copy out of the channel-message field.                          |

---

## Consuming MarketIR (site bridge)

The public site treats this repo as a **read-only upstream**. No runtime fetches — everything is resolved at build time.

```
mcpt-marketing (MarketIR, this repo)
        │
        │  fetch + sha256 verification (lockfile-enforced)
        ▼
vendor snapshot (build-time, gitignored in site repo)
        │
        │  Astro static build
        ▼
mcptoolshop.com
```

The site's `fetch-marketir.mjs` script downloads files referenced in the lockfile, verifies every hash, and writes a local snapshot. If any hash mismatches, the build aborts. This keeps marketing traceable and reproducible.

### Consumer contract

For consumers vendoring MarketIR (the public site, future generators, anyone else), the stable surface is:

- **Stable for consumers**:
  - `marketing/data/**` — tools, audiences, campaigns, and the root index (`marketing.index.json`)
  - `marketing/manifests/marketing.lock.json` — the lockfile (canonical inventory + sha256 per file)
  - `marketing/manifests/evidence.manifest.json` — evidence registry with sha256 + bytes + provenance
  - `marketing/schema/**` — JSON Schema definitions (used to validate ingested data)
- **Internal — do not depend on**:
  - `marketing/scripts/**` — generation/validation scripts (may be renamed or restructured without notice)
  - `test/**`, `node_modules/`, top-level config (`.prettierrc`, etc.)

### How to fetch

Consumers should resolve files through the lockfile rather than hard-coding paths. A typical recipe:

1. Fetch `marketing/manifests/marketing.lock.json` from a known commit (tag or branch).
2. Read `schemaVersion` from the lockfile and refuse to ingest if the major version differs from what your consumer expects (see Versioning below).
3. For each entry in the lockfile, fetch the referenced file (e.g., from `https://raw.githubusercontent.com/mcp-tool-shop/mcpt-marketing/<tag>/<path>`) and verify its sha256 matches the lockfile entry.
4. Abort the build on any hash mismatch — the data is no longer self-consistent.

The site bridge (`fetch-marketir.mjs`) is the reference implementation of this recipe. See `examples/consume.mjs` for a runnable reference consumer that demonstrates the lockfile-first walk, sha256 verification, and tool summarization end-to-end without leaving this repo.

### Aliases and deprecation

IDs are never renamed; they are deprecated. When a tool, claim, or message is renamed in spirit, the old ID is kept with `status: "deprecated"` and the audit trail intact. A future schema revision may add an explicit `aliases` field for cleaner consumer migration; until then, consumers should treat any `deprecated` entity as terminal — keep displaying it if your consumer chooses, but do not silently rewrite IDs.

---

## Contribution rules

The quality bar is simple and non-negotiable:

- **Every claim must be falsifiable** — testable in principle, not just feel-good copy
- **Upgrade aspirational → proven** only when you add evidence
- **Messages must reference claims** — if it's said, it must be claimed
- **Add anti-claims** whenever a tool is likely to be misused or misunderstood
- **No orphan content** — everything must be reachable from the index

---

## Testing

```bash
npm test
```

Runs 46 tests across five suites under `test/` via the Node built-in test runner (no external test framework):

- **`test/version.test.mjs`** — 5 version-consistency tests
  - `package.json` version is canonical semver (X.Y.Z\[-pre]\[+build])
  - `package.json` MAJOR matches the latest `## [X.Y.Z]` heading in `CHANGELOG.md`
  - `CHANGELOG.md` contains a section heading for the current version (not just a link reference)
  - `LICENSE` begins with "MIT License"
  - `marketing/` exists and contains `schema/`, `data/`, `manifests/` subdirectories
- **`test/gen-lock.test.mjs`** — 7 determinism + lockfile tests (lockfile drift detection, byte-stable serialization, ref-traversal hardening)
- **`test/validate.test.mjs`** — 10 schema + invariant tests (negative-path coverage for proven-without-evidence, orphan files, hash mismatch, forbidden phrases, message length, etc.)
- **`test/hash-file.test.mjs`** — 4 hashing-utility tests (known-vector, empty file, POSIX path normalization, usage error)
- **`test/_paths.test.mjs`** — 20 path-traversal-guard tests (`assertSafeRef` and `assertSafePath` rejection + acceptance paths)

CI runs `npm test` on every push and pull request.

---

## Versioning

MarketIR changes are versioned via `schemaVersion` in the schema and data files. The current major is `1`.

### What counts as breaking, additive, or cosmetic

| Bump  | Examples                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| Major | Renaming a field, removing a field or `$def`, changing a field's type, tightening an `enum`, restructuring nested shapes  |
| Minor | Adding a new optional field, adding a new `$def`, loosening an `enum`, adding a new entity type behind a new index branch |
| Patch | Description text, comments, ordering of `$defs` (output is byte-identical via deterministic serialization)                |

If a change makes a previously-valid document invalid against the new schema, it is breaking — regardless of how small it looks.

### Deprecation lifecycle (schema fields)

When a schema field becomes obsolete:

1. Mark it as deprecated in the schema (`description: "Deprecated as of vX.Y; …"`) in a **minor** release. Keep accepting it.
2. Update `CHANGELOG.md` with `consumer-impact: yes` and explicit migration guidance.
3. In the next **major** release, the field may be removed. Consumers have a full major version to migrate.

Single-step removal (deprecate + remove in the same release) is allowed only when the field is provably unused — i.e., zero data files reference it and no public consumer depends on it. Document the audit in the changelog.

### ID deprecation lifecycle (data entities)

IDs themselves are never renamed or removed. A claim, tool, message, or evidence record that is no longer current is set to `status: "deprecated"` (where the entity supports a status field) or moved into a deprecated section, but stays in the index for audit. This is the inverse of schema-field deprecation: schema fields can disappear; entity IDs are forever.

### Coordination with consumers

When a release contains breaking changes, the changelog entry must:

- State the new major version.
- List every removed or restructured field, with a one-sentence migration note.
- Tag the entry `consumer-impact: yes` so downstream vendors (the site bridge, future generators) can search for impactful releases.

Consumers should pin to a specific tag, read `schemaVersion` from the fetched lockfile, and refuse to ingest if the major differs from what they were built against.

---

## Security

No secrets, private URLs, API keys, or customer identifiers belong in this repo. Evidence means public artifacts — screenshots, CI links, test results — not internal logs or credentials. If something can't be shown publicly, it's not evidence.

The full data-scope table (data touched, data NOT touched, permissions, network, telemetry) lives in [SECURITY.md](SECURITY.md), which is also where you go to report a vulnerability. SECURITY.md is the single source of truth for the threat model.

---

## Scorecard

| Category            | Score     |
| ------------------- | --------- |
| A. Security         | 9         |
| B. Error Handling   | 7         |
| C. Operator Docs    | 9         |
| D. Shipping Hygiene | 9         |
| E. Identity (soft)  | 8         |
| **Overall**         | **42/50** |

> **Score: 42/50** (revised down from 50/50 after honest re-audit; see [SCORECARD.md](SCORECARD.md#why-scores-were-revised-down) for methodology).
>
> Full audit: [SHIP_GATE.md](SHIP_GATE.md) · [SCORECARD.md](SCORECARD.md) (last reviewed + audit cadence live in SCORECARD.md as the single source of truth).

---

## License

MIT (see [LICENSE](LICENSE)).

---

<p align="center">Built by <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a></p>
