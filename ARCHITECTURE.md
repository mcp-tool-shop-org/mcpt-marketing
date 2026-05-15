# Architecture

This document explains **why mcpt-marketing is shaped the way it is**. The README covers what the repo does and how to use it; this is the design rationale for the load-bearing decisions, so future contributors don't have to derive it from folklore.

If you find yourself proposing "let's just use UUIDs" or "let's drop the lockfile to simplify," start here.

---

## Why MarketIR exists

The problem: marketing copy and product reality drift apart. A product changes; the marketing page doesn't. Or marketing makes a claim ("deterministic," "secure," "fast") that was true at one point and isn't anymore — but no one notices because the copy lives in a CMS and the truth lives in a test report somewhere else, and the two have no link.

mcpt-marketing fixes this by treating marketing data as **structured, versioned, evidence-linked records** — the same discipline a real product applies to its API or its database schema. Every claim has a status (`proven` / `aspirational` / `deprecated`); every `proven` claim has a hash-verified evidence artifact; every message references the claims it depends on. The validator refuses to ship anything that breaks the chain.

The result: when a product changes, the linked claims become falsifiable in a different way (the evidence sha256 stops matching, or the evidence stops describing the new behavior), and the failure surfaces in CI rather than in customer complaints.

---

## Core invariants

The whole repo orbits four invariants:

1. **Falsifiability** — every claim must be testable in principle. "Fast" is rejected by review; "completes typical builds in under one second on commodity hardware" is allowed because it can be measured and disproved.
2. **Hash-verified evidence** — every `proven` claim points to an evidence record carrying a sha256 of an actual file. The validator re-hashes the file at build time and fails on mismatch. This makes "we verified X" itself a verifiable statement.
3. **Deterministic generation** — the lockfile and every JSON file are byte-stable. Same inputs, same outputs, every time. This is enforced by sorted keys, stable array ordering, trailing newlines, and a CI check (`lock:check`) that fails if regenerating produces a different file.
4. **Schema strictness** — every data file conforms to a JSON Schema (2020-12). AJV runs in strict mode with `additionalProperties: false`, so no field appears anywhere unless the schema explicitly admits it.

These four are not preferences. They are the design contract that makes everything else honest.

---

## Data flow

```
data files (humans edit)
  │
  ├──> validate.mjs  ──> schema check + 12+ structural invariants
  │
  ├──> gen-lock.mjs  ──> marketing.lock.json (sha256 per file)
  │
  └──> evidence/<file>  <──  hash-file.mjs  (compute sha256 + bytes)
                              │
                              └──> evidence.manifest.json (registry)

                                                │
                                                ▼
                            site bridge (consumer repo)
                              │
                              ├──> fetch lockfile from GitHub
                              ├──> for each entry: fetch + verify sha256
                              └──> build static site if every hash matches
```

Humans only edit files in `marketing/data/**` and `marketing/manifests/evidence.manifest.json`. The lockfile is generated. The schema is authored but rarely touched.

---

## Components

| Component                                    | Role                                                                                                                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `marketing/schema/marketing.schema.json`     | The canonical contract — defines every shape, every ID format, every enum. AJV validates against this.                             |
| `marketing/data/marketing.index.json`        | The root index. Every other data file must be reachable from here, or it is rejected as an orphan.                                 |
| `marketing/data/tools/**`                    | Per-tool records: positioning, claims, messages, press, targeting.                                                                 |
| `marketing/data/audiences/**`                | Per-audience records: pain points, context. Tools reference audiences via `audienceRefs`.                                          |
| `marketing/data/campaigns/**`                | Per-campaign records: phases, channel sequences, asset references.                                                                 |
| `marketing/manifests/evidence.manifest.json` | Evidence registry. Each entry has `id`, `path`, `sha256`, `bytes`, `provenance`. Claims reference IDs.                             |
| `marketing/manifests/marketing.lock.json`    | Generated lockfile. Pins every included file by sha256. The consumer contract.                                                     |
| `marketing/scripts/validate.mjs`             | The validator. Schema check + 12 structural invariants (proven-without-evidence, orphans, hash mismatch, forbidden phrases, etc.). |
| `marketing/scripts/gen-lock.mjs`             | The lockfile generator. Deterministic — same inputs, byte-identical output.                                                        |
| `marketing/scripts/hash-file.mjs`            | Single-file hash utility. Used when registering new evidence.                                                                      |
| `marketing/scripts/_paths.mjs`               | Shared module for path resolution + safety guards (`assertSafeRef`, `assertSafePath`).                                             |

---

## Why these design choices

### Why a lockfile (vs trusting the data files)

The lockfile gives consumers a single small file to fetch first, with sha256s for every other file they will fetch. Without it, consumers would have to either (a) fetch every file blindly and hope they got a self-consistent snapshot, or (b) implement their own enumeration. The lockfile is the "table of contents with checksums" that makes the rest of the repo safe to consume from a static fetch.

It also catches authoring mistakes: if a contributor edits a data file but forgets to regenerate the lockfile, `lock:check` fails in CI. The check is cheap, the failure mode is loud.

### Why namespaced IDs (vs UUIDs)

IDs like `claim.zip-meta-map.deterministic-output` carry structure that humans use:

- **Stability** — the ID encodes the entity's permanent identity. UUIDs are stable but opaque; namespaced IDs are stable and self-describing.
- **Readability** — when a human reads `evidenceRefs: ["ev.zip-meta-map.test-report.v1"]`, they know what it points at without an indirection. With UUIDs, every reference is an opaque pointer.
- **Audit** — when a claim is deprecated, the namespaced ID still tells you what it was about. UUIDs lose this when the human-readable name changes.

The trade-off: namespaced IDs require a discipline (never rename — deprecate). UUIDs would be more accommodating to renames but at the cost of every other property above. We picked the discipline.

### Why JSON Schema 2020-12 (vs Zod / Yup / TypeScript types)

The schema is the contract between the producer (this repo) and the consumer (the site bridge — and any future consumer). That contract has to be:

- **Language-neutral** — the consumer might be JavaScript today, Python or Rust tomorrow. JSON Schema is consumable by every stack via well-maintained libraries. Zod is JavaScript-only.
- **Versioned** — JSON Schema has explicit `$schema` and `$id` fields and a long history of versioning. Treating the schema itself as a versioned artifact maps cleanly onto MarketIR's own `schemaVersion` discipline.
- **Standards-based** — JSON Schema is an IETF draft standard. Tooling, documentation, and human familiarity all benefit from this.

TypeScript types were considered and rejected: they describe shapes at compile time but provide no runtime validation, and the consumer might not be a TypeScript codebase.

### Why proof-first (vs "we'll add evidence later")

The whole thesis is that marketing copy drifts from reality. If we let `proven` claims exist without backing evidence ("we'll add the link later"), we have built nothing — we've just moved the trust problem from the marketing page into the structured record. The validator's hard rejection of proven-without-evidence is what makes the data structurally honest.

The escape hatch for unverified claims is `status: "aspirational"`. This isn't a workaround; it's the design. A pre-launch tool with seven aspirational claims (see `zip-meta-map.json`) is honest. A pre-launch tool with seven `proven` claims and no evidence would be broken by design.

### Why deterministic serialization (vs "good enough" JSON output)

Without sorted keys and stable ordering, the lockfile would change every time `gen-lock.mjs` ran, even with no data changes. That would break `lock:check` and make every PR diff include lockfile churn. Determinism is the difference between a lockfile that is meaningful (changes only when data changes) and one that is noise.

This also makes the build truly reproducible: a contributor on a different OS, a different filesystem, a different Node version, all produce the byte-identical lockfile. That property is consumer-relevant — the site bridge can sha256-verify the lockfile itself if it wants to.

### Why a shared `_paths.mjs` module

Three scripts (`validate`, `gen-lock`, `hash-file`) all need to resolve paths relative to the repo root and need to refuse path-traversal escapes (`../etc/passwd` and friends). Centralizing this logic in `_paths.mjs` means:

- Path resolution is consistent across scripts.
- Safety guards (`assertSafeRef`, `assertSafePath`) are tested once (20 tests in `test/_paths.test.mjs`) and reused.
- A future script automatically gets the safety properties by importing the same helpers.

This was added in dogfood swarm wave 2 specifically because the safety guards were being implemented inconsistently across scripts. The shared module fixed both the inconsistency and the test gap.

---

## The consumer relationship

The consumer of MarketIR is currently a site bridge (`fetch-marketir.mjs` in a separate site repository). The contract between this repo and that consumer is documented in **README → Consuming MarketIR (site bridge) → Consumer contract**.

The short version: the consumer fetches the lockfile, verifies every referenced file's sha256, and refuses to build on any mismatch. The consumer is welcome to read schema files and data files directly; it must not depend on script internals (`marketing/scripts/**`), test files, or anything outside the documented stable surface.

The consumer is responsible for handling `schemaVersion` compatibility. See **README → Versioning** for the policy.

---

## Extension points

The architecture is intentionally minimal. When new requirements arrive, these are the natural extension points:

- **Aliases** (planned) — for cleaner consumer migration after a rename. Would land as an additive `aliases` field on entity records.
- **Deprecation metadata** (planned) — when a schema field is deprecated, an explicit `deprecatedSince` field would let consumers warn their own users with version context. Currently, deprecation lives only in the schema's `description` text.
- **`x-*` extension fields** (considering) — for consumer-specific metadata that should not pollute the canonical schema. Mirrors the JSON Schema convention.

See [ROADMAP.md](ROADMAP.md) for the full set.

---

## What this architecture is not

- It is not a CMS. There is no editing UI, no draft state, no preview workflow beyond `npm run validate`.
- It is not a runtime API. Consumers fetch and vendor at build time; there is no live server.
- It is not a marketing-automation platform. It produces structured records; downstream tools may consume them, but this repo does not push to anywhere.
- It is not magic. (The validator forbids the word.) Every guarantee in this repo is the consequence of a specific, named invariant, enforced by a specific, named test or check.
