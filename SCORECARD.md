# Scorecard

> Score a repo before remediation. Fill this out first, then use SHIP_GATE.md to fix.

**Repo:** mcpt-marketing
**Last reviewed:** 2026-05-15 (post dogfood swarm wave 2)
**Audit cadence:** re-score on every minor release, or quarterly — whichever comes first.
**Type tags:** [npm] (package marked `"private": true` — source repo is GitHub-public, package is not published to npm)

## Pre-Remediation Assessment (2026-02-27)

| Category            | Score     | Notes                                                          |
| ------------------- | --------- | -------------------------------------------------------------- |
| A. Security         | 5/10      | No SECURITY.md, no threat model in README.                     |
| B. Error Handling   | 7/10      | Validation scripts with error handling. No formal audit.       |
| C. Operator Docs    | 7/10      | Good README with schema docs. Missing CHANGELOG, SHIP_GATE.    |
| D. Shipping Hygiene | 6/10      | validate + lock scripts. Missing audit trail, still at v0.1.0. |
| E. Identity (soft)  | 2/10      | No logo, no translations, no landing page.                     |
| **Overall**         | **27/50** |                                                                |

## Key Gaps (original)

1. No SECURITY.md, SHIP_GATE.md, SCORECARD.md, CHANGELOG.md
2. Still at v0.1.0 — needs promotion to v1.0.0
3. No logo, translations, or landing page (internal repo)

## Remediation Priority

| Priority | Item                                                         | Estimated effort |
| -------- | ------------------------------------------------------------ | ---------------- |
| 1        | Create SECURITY.md + SHIP_GATE.md + SCORECARD.md + CHANGELOG | 5 min            |
| 2        | Add Security & Data Scope to README                          | 3 min            |
| 3        | Promote to v1.0.0                                            | 1 min            |

## Post-Remediation (revised 2026-05-15)

| Category            | Before    | Initial (2026-02-27) | Revised (2026-05-15) | Notes                                                                                                                                                        |
| ------------------- | --------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A. Security         | 5/10      | 10/10                | 9/10                 | SECURITY.md present, threat model in README, CodeQL added in wave 2. Disclosure address fixed (GHSA URL). Held back from 10 until secret-scanning is proven. |
| B. Error Handling   | 7/10      | 10/10                | 7/10                 | Scripts have try/catch envelopes (added wave 2). Full Structured Error Shape (`code`/`hint`/`retryable`) is **planned for v1.1**, not present today.         |
| C. Operator Docs    | 7/10      | 10/10                | 9/10                 | README accurate (script names match package.json, Testing section added). CHANGELOG present with [Unreleased]. CONTRIBUTING.md not yet authored.             |
| D. Shipping Hygiene | 6/10      | 10/10                | 9/10                 | Tests now run in CI (wave 2). Dependabot + CodeQL added (wave 2). `verify` umbrella script not yet added — **planned for v1.1**.                             |
| E. Identity (soft)  | 2/10      | 10/10                | 8/10                 | GitHub repo metadata present (description, homepage, topics). No logo or translations — out of scope for an internal infra repo.                             |
| **Overall**         | **27/50** | **50/50**            | **42/50**            |                                                                                                                                                              |

### Why scores were revised down

The 2026-02-27 self-score gave straight 10s on the strength of "we created the audit docs." The 2026-05-15 dogfood swarm found that several 10s were unearned:

- **Security** ignored that no dependency scanning ran in CI. CodeQL added wave 2.
- **Error Handling** ignored that scripts threw raw `Error`/string messages. Wave 2 added envelopes; the structured shape is still future work.
- **Shipping Hygiene** ignored that the documented `verify` script did not exist in package.json, that tests existed but were not wired to CI, and that there was no automated dependency update mechanism. Tests now run in CI (wave 2). Dependabot added (wave 2). `verify` umbrella deferred to v1.1.

The revised 42/50 reflects the actual ship-ready state and leaves headroom that requires real follow-up work to close — consistent with this repo's falsifiability thesis.
