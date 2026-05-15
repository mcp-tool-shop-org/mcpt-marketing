# mcpt-marketing

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
test/               # node:test suites — version, gen-lock, validate, hash-file, _paths (46 tests)
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

## How it's consumed (site bridge)

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

MarketIR changes are versioned via `schemaVersion` in the schema and data files. Breaking changes (renamed fields, removed properties, structural changes) require a major bump. Additive changes (new optional fields, new `$defs`) are minor. Downstream consumers like the site bridge should check `schemaVersion` compatibility before ingesting.

---

## Security

No secrets, private URLs, API keys, or customer identifiers belong in this repo. Evidence means public artifacts — screenshots, CI links, test results — not internal logs or credentials. If something can't be shown publicly, it's not evidence.

### Data scope

| Aspect               | Detail                                                                      |
| -------------------- | --------------------------------------------------------------------------- |
| **Data touched**     | Marketing claim/evidence JSON files (local), lock files with SHA-256 hashes |
| **Data NOT touched** | No user data, no credentials, no databases, no external services            |
| **Permissions**      | Read/write: marketing data files in repo only                               |
| **Network**          | None — fully offline validation and generation tools                        |
| **Telemetry**        | None collected or sent                                                      |

See [SECURITY.md](SECURITY.md) for vulnerability reporting.

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
> Last reviewed: 2026-05-15. Full audit: [SHIP_GATE.md](SHIP_GATE.md) · [SCORECARD.md](SCORECARD.md)
>
> **Audit cadence:** re-score on every minor release, or quarterly — whichever comes first.

---

## License

MIT (see [LICENSE](LICENSE)).
