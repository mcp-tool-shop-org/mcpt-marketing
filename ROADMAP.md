# Roadmap

A short, honest map of where mcpt-marketing is and where it is heading. Items are tagged **planned**, **considering**, or **not planned** so readers can tell intent from speculation. No commitment dates — intent is what matters here.

---

## Currently shipped (v1.0.0)

- One tool dataset: `tool.zip-meta-map`
- Two audiences: `aud.ci-maintainers`, `aud.llm-toolchain-devs`
- One campaign: `camp.zip-meta-map.launch`
- Schema (`marketingSchema` v1.0.0) with 46 tests under `test/`
- Lockfile-pinned, sha256-verified deterministic build
- CI: validate, lock:check, format check, test, CodeQL, Dependabot

---

## Pre-launch (zip-meta-map dependencies — pre-launch outside this repo)

The `zip-meta-map` tool currently has every claim marked `aspirational` because the upstream tool repository is not yet public. Resolving these is the highest-priority near-term work, but most of it lives **outside this repo** — the marketing data here can only become `proven` once the upstream evidence exists and is publicly verifiable.

- **planned** — Upstream `zip-meta-map` repository public release (external).
- **planned** — `zip-meta-map` PyPI publish, so install instructions in marketing copy are testable (external).
- **planned** — Falsifiable test report for `claim.zip-meta-map.token-budgets` (token-budget property test producing a reproducible artifact).
- **planned** — Deterministic test report for `claim.zip-meta-map.deterministic-output` (re-running the index on the same input produces byte-identical output, with the test artifact registered in `evidence.manifest.json`).
- **planned** — Schema-validation test report for `claim.zip-meta-map.schema-validated`.

Once these land upstream, the corresponding claims in `marketing/data/tools/zip-meta-map.json` get upgraded from `aspirational` to `proven` with `evidenceRef` entries pointing at the new artifacts.

---

## v1.1 (planned)

These are the items already named in `CHANGELOG.md` under `[Unreleased] → Deferred`:

- **planned** — `verify` umbrella script in `package.json` composing `validate` + `lock:check` + `test`. Replaces the current explicit chain.
- **planned** — Full Structured Error Shape (`code`, `message`, `hint`, `cause?`, `retryable?`) across all scripts. Wave 2 shipped basic try/catch envelopes only.

---

## Planned tools

This section names tools we intend to add. Inclusion here is a signal of intent, not a commitment. A tool is only added to the dataset when its first marketing record can be authored honestly — pre-launch tools with all-aspirational claims are valid (see `zip-meta-map.json`); empty placeholders are not.

- **considering** — Additional MCP servers from the mcp-tool-shop org as they reach launch readiness.
- **considering** — Internal tooling that reaches public-release maturity.

The shape of each entry will mirror `zip-meta-map.json`: tool record + audience refs + claims (status-labeled) + messages + press boilerplate + targeting.

---

## Schema roadmap

- **considering** — Explicit `aliases` field on entity records, so consumer migration after a rename can be automated. Today, IDs are never renamed (only deprecated), but an alias field would let consumers cleanly switch displayed labels without losing the audit trail. Would land as a minor (additive) bump.
- **considering** — `x-*` extension fields (mirroring the JSON Schema convention) for consumer-specific metadata that should not pollute the canonical schema. Would land as a minor (additive) bump.
- **not planned** — Per-tool sub-directories (e.g., `marketing/data/tools/zip-meta-map/claims.json`, `messages.json`). The current per-tool flat file is fine at the dataset's current size; restructuring is unstudied beyond ~50 tools. Will revisit if the dataset reaches that scale.

---

## Explicitly not planned

These are the things this repo will **not** become, restated for clarity (already implied by README's "What this is not"):

- **not planned** — A CMS or admin UI. Edits go through git.
- **not planned** — Runtime fetches by consumers. Everything is resolved at build time, with hash verification.
- **not planned** — Vibes-based copy that cannot be tested. Every claim must be falsifiable; every message must reference claims.
- **not planned** — A blog. Long-form prose lives in product READMEs and the public site; marketing data here is structured records, not narrative.
- **not planned** — Integration with marketing-automation platforms (HubSpot, Mailchimp, etc.). The output is JSON; downstream tools may consume it, but mcpt-marketing does not push to them.

---

## Suggesting changes

Open an issue at https://github.com/mcp-tool-shop/mcpt-marketing/issues with a short proposal. The bar is the same as for the rest of the repo: if the change introduces a new claim or a new product-shape statement, it must be falsifiable.
