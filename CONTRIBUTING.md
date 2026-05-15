# Contributing to mcpt-marketing

Thanks for your interest. This repo defines **MarketIR** — a deterministic, falsifiable representation of product marketing data — and the bar for changes is high in a specific, narrow way: **every claim must be testable, and the build must stay byte-reproducible**.

This guide covers the dev loop, how to add new entities, and the honesty principles that the validator enforces.

---

## Quick start

```bash
git clone https://github.com/mcp-tool-shop/mcpt-marketing.git
cd mcpt-marketing
npm install
npm run validate
npm test
```

If all three commands pass, your environment is set up correctly. Node 20+ is required (see `package.json` `engines`).

---

## Development loop

The typical edit cycle is:

1. **Edit data** under `marketing/data/**` (a tool, audience, or campaign file).
2. **Add or update evidence** in `marketing/manifests/evidence.manifest.json` if you changed a `proven` claim's backing artifact. New artifacts go under `marketing/evidence/`.
3. **Validate**: `npm run validate` — catches schema and invariant violations.
4. **Regenerate the lockfile**: `npm run lock`. Commit the updated `marketing.lock.json` along with your data changes.
5. **Run tests**: `npm test`.
6. **Format**: `npm run fmt` (or check with `npm run fmt:check`).

CI runs `npm run validate`, `npm run lock:check`, `npm run fmt:check`, and `npm test` on every push and PR. Locally running these in the same order is the fastest way to be confident your PR will pass.

For one-line examples of every script, see the **Scripts reference** section in [README.md](README.md).

---

## Adding a new tool

1. Create `marketing/data/tools/<tool-id>.json` (e.g., `marketing/data/tools/foo-bar.json`).
2. Use the existing `zip-meta-map.json` as a structural reference. Required top-level fields: `schemaVersion`, `id`, `name`, `positioning`, `audienceRefs`, `claims`, `messages`, `press`, `targeting`.
3. The tool's `id` must follow the namespace pattern `tool.<slug>` (see README's "IDs are stable and permanent" section).
4. Add a `tools` entry referencing the new file in `marketing/data/marketing.index.json`. Files not reachable from the index are rejected as orphans by the validator.
5. Run `npm run lock` to regenerate the lockfile so the new tool is pinned.
6. Run `npm run validate` and `npm test`.

---

## Adding a new claim

Claims live inside a tool's `claims` array. Two key fields decide everything:

- **`status`**: `proven`, `aspirational`, or `deprecated`.
- **`evidenceRef[]`** (only for `proven`): IDs from `evidence.manifest.json`.

### When `status: "proven"`

A proven claim **must** include at least one `evidenceRef`. The validator rejects proven claims with zero evidence — this is the load-bearing invariant of the whole repo.

The referenced evidence record must:

- Exist in `marketing/manifests/evidence.manifest.json` with a unique `id`.
- Have a real `path` to a file under `marketing/evidence/` (or `null` if the artifact lives elsewhere — but then it is not hash-verified).
- Carry a `sha256`, `bytes`, and `provenance` block. Compute the hash with `npm run hash -- marketing/evidence/<file>`.

If the file on disk doesn't match the recorded sha256, the validator fails. This makes "we verified X" a falsifiable statement: re-run the hash, see for yourself.

### When `status: "aspirational"`

Aspirational claims are allowed without evidence, but they must be honestly labeled. Upgrade to `proven` only when you add the evidence.

Pre-launch tools and forward-looking claims belong here. The current `zip-meta-map.json` is a good example — every claim is aspirational pending the upstream public release.

### When `status: "deprecated"`

Deprecated claims are kept for the audit trail and never deleted. They should not be referenced by new messages.

---

## Schema changes

The schema lives in `marketing/schema/marketing.schema.json` and is versioned via `schemaVersion`. The current major is `1`.

When to bump:

| Bump  | Trigger                                                                           |
| ----- | --------------------------------------------------------------------------------- |
| Major | Renaming a field, removing a field, tightening an `enum`, restructuring a shape   |
| Minor | Adding an optional field, adding a new `$def`, loosening an `enum`                |
| Patch | Description text, comment-only changes (output stays byte-identical via gen-lock) |

Breaking changes require:

1. The bump in `schema/marketing.schema.json` and in every data file's `schemaVersion`.
2. A `CHANGELOG.md` entry under `[Unreleased]` tagged `consumer-impact: yes`.
3. A short migration note in the changelog describing what consumers need to change.

Deprecation lifecycle: a field marked deprecated in a minor release may be removed in the next major. See README's **Versioning** section for the full policy.

---

## Forbidden phrases

Each tool's `press.boilerplate.forbiddenPhrases` lists strings the validator refuses to see anywhere in that tool's prose (messages, positioning, anti-claims, project description, quotes). The union of every tool's list is also enforced project-wide against campaigns and audiences.

The current per-tool list (see `marketing/data/tools/zip-meta-map.json`) blocks: `AI-powered`, `revolutionary`, `game-changer`, `magic`, `next-generation`.

**Why these phrases are blocked:** they are the standard marketing reflexes that erode credibility. "AI-powered" tells the reader nothing about what the tool actually does. "Revolutionary" and "game-changer" are claims of impact that cannot be falsified. "Magic" is the opposite of what a deterministic pipeline should sound like. "Next-generation" is a temporal claim with no anchor — next compared to what, when?

The list is intentionally short. If you find yourself wanting to add to it, propose the addition in the same PR with a short explanation in the changelog.

---

## Honesty principles

These are not style preferences. They are validator-enforced or audit-enforced.

1. **Falsifiability** — every claim must be testable in principle, even if you haven't tested it yet. "Fast" is not falsifiable; "completes typical builds in under one second on commodity hardware" is. If you cannot describe the failure mode that would prove the claim wrong, the claim should not exist.
2. **Aspirational means aspirational** — if you don't have evidence, mark it `aspirational`. Do not write `proven` and "plan to add evidence later." The validator rejects this.
3. **First-party quotes are boilerplate, not press** — `press.boilerplate.projectDescription` is your team's voice. `press.quotes[]` is for quotes from third parties (users, reviewers, integrators). Don't use the press section to ventriloquize yourself.
4. **Anti-claims protect honesty** — when a tool is likely to be misused or misunderstood, add an anti-claim. `zip-meta-map.json` shows the pattern: "Does not perform runtime vulnerability scanning."
5. **Drift is silent** — when you change a fact in one doc, search the repo for other places it might also live. The de-duplication structure in this repo (single sources of truth for test counts, audit dates, data-scope tables) is designed to make this less work, not more.

---

## Drift-prevention checklist

Before opening a PR, scan for these common drift patterns:

- **Test count or per-suite breakdown changed?** Update the README **Testing** section only. CHANGELOG should describe the delta, not enumerate totals.
- **Audit performed (or stale doc updated)?** Update `SCORECARD.md`'s `Last reviewed` line. Other docs link to it; do not edit dates anywhere else.
- **Threat model touched (data scope, network behavior, secrets handling)?** Update `SECURITY.md`. The README's Security section just links to it — do not duplicate the table.
- **Scripts changed in `package.json`?** Update the README **Scripts reference** table.
- **Schema changed?** See "Schema changes" above for the full checklist.

---

## Where to ask questions

- **Bugs and feature requests** — open an issue at https://github.com/mcp-tool-shop/mcpt-marketing/issues
- **Security issues** — see [SECURITY.md](SECURITY.md). Use GitHub's private vulnerability advisory; do not open a public issue for a vulnerability.
- **Design discussions** — for substantial changes, open an issue first to discuss before writing the PR.

---

## Release process

See [RELEASING.md](RELEASING.md).
