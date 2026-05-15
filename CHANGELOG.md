# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

Dogfood swarm wave 2 (2026-05-15) landed cross-cutting hardening.

### Added

- 41 new test cases under `test/` (5 → 46 total): `test/gen-lock.test.mjs` (determinism + lockfile drift, 7 tests), `test/validate.test.mjs` (schema + invariant negative paths, 10 tests), `test/hash-file.test.mjs` (hashing utility, 4 tests), `test/_paths.test.mjs` (path-traversal guards, 20 tests).
- CI: Dependabot config (`.github/dependabot.yml`) for automated dependency updates.
- CI: CodeQL workflow (`.github/workflows/codeql.yml`) for code scanning on every push and PR.
- CI: minimal-permissions block on GitHub Actions workflows.
- Repo ownership: `.github/CODEOWNERS`.
- Scripts: `marketing/scripts/_paths.mjs` shared-paths module (single source of truth for repo path resolution across scripts).
- Docs: top-level README Testing section.

### Changed

- Marketing-data contract: dead URLs and unverified PyPI claims downgraded to aspirational.
- Validator hardening: `validate.mjs` enforces hash-verified evidence; `gen-lock.mjs` is fully deterministic; AJV runs in strict mode.
- Error envelopes: scripts wrap failures in friendly try/catch envelopes (full Structured Error Shape with `code`/`hint`/`retryable` is **planned for v1.1**).
- Docs accuracy: README script names match `package.json`.
- SCORECARD methodology: now reports honest revised scores (42/50) alongside the original self-score (50/50) — see SCORECARD.md "Why scores were revised down."
- SHIP_GATE: gate rows annotated with explicit verification dates (`(YYYY-MM-DD)`).

### Fixed

- SECURITY.md disclosure address switched to GitHub's private vulnerability advisory (GHSA URL).

### Deferred

- `verify` umbrella script (composing `validate` + `lock:check` + `test`) — **planned for v1.1**. Today the equivalent is the explicit `npm run validate && npm run lock:check && npm test` chain that CI runs.
- Full Structured Error Shape (`code` / `message` / `hint` / `cause?` / `retryable?`) — **planned for v1.1**. Wave 2 shipped basic try/catch envelopes only.

## [1.0.0] - 2026-02-27

### Added

- SECURITY.md with scope and response timeline
- SHIP_GATE.md and SCORECARD.md for product audit trail
- Security & Data Scope section in README
- CHANGELOG.md

### Changed

- Promoted to v1.0.0 stable release
