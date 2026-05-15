# MarketIR consumer examples

This directory holds reference implementations of downstream consumers of the
MarketIR data set. They are documentation that runs.

## Contents

| File          | Purpose                                                                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `consume.mjs` | Reference consumer — reads the lockfile, verifies sha256 integrity for every locked file, walks the index, and prints a per-tool summary. |

## When to read these examples

- You are building a downstream consumer (e.g. the public mcptoolshop.com
  site, a Slack notifier, a static-site generator integration) and want a
  worked example of the lockfile-verify-then-walk pattern.
- You are evaluating whether to depend on this dataset and want a 5-minute
  proof that the contract works the way the README claims.
- You are debugging a "why does my snapshot diverge from the lockfile" issue
  and want a known-good reference implementation to diff against.

## When NOT to copy these examples wholesale

The example uses **relative filesystem paths** to keep the demo runnable from
a fresh checkout with no setup. A production consumer should:

- Use a **stable URL** (e.g. `raw.githubusercontent.com/<tag>/<path>`) instead
  of relative paths, so the consumer is not coupled to a local checkout layout.
- **Cache aggressively** — every IR file is content-addressed via the
  lockfile's sha256, so a sha256 match is a byte-for-byte cache hit.
- **Validate against the published JSON Schema** rather than trusting the
  field shape produced by the example.
- **Pin to a specific tag** rather than fetching from `main` so a producer-side
  edit cannot change the bytes you depend on without your knowledge.

## Running consume.mjs

From the repo root:

```bash
node examples/consume.mjs              # human-readable summary
node examples/consume.mjs --json       # structured JSON to stdout
node examples/consume.mjs --root <p>   # alternate marketing/ tree
node examples/consume.mjs --help       # full options
```

Exit codes:

- `0` — Walked + verified everything successfully.
- `1` — Integrity failure (sha256 mismatch / unreadable file / schema mismatch).

## What `consume.mjs` actually does

1. Reads `marketing/manifests/marketing.lock.json` (the entry point).
2. Checks the lockfile's `schemaVersion` against the supported MAJOR; warns
   on mismatch.
3. For each entry in `lock.files[]`, recomputes `sha256` + `bytes` from disk
   and compares to the lockfile entry. This is the **load-bearing** step —
   without it, the lockfile is "polite suggestion," not "tamper-evident."
4. Reads `marketing/data/marketing.index.json` and walks `tools[]`,
   `audiences[]`, `campaigns[]`.
5. For each tool, prints: name, oneLiner, status counts (proven /
   aspirational / deprecated), first 2 messages, and a press boilerplate
   snippet.

## When the consumer contract changes

If you add a new file under `marketing/`, the lockfile-walk step automatically
picks it up — no consumer change needed.

If you change the **shape** of the IR (e.g. rename a field, add a new top-level
section), update `consume.mjs` to demonstrate the new field. Drift between the
schema and this example is a contract-surface bug; the docs domain owns
flagging it during review.
