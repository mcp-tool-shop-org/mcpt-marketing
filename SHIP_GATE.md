# Ship Gate

> No repo is "done" until every applicable line is checked.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

**Last reviewed + audit cadence:** see [SCORECARD.md](SCORECARD.md) (canonical source — keeps the date in one place).

**Repo state:** GitHub repository is **PUBLIC** (`mcp-tool-shop/mcpt-marketing`). The npm package manifest sets `"private": true` — i.e., the package is not published to the npm registry, but the source repo is open.

**Notation legend:** `[x]` = done · `[ ]` = not done · `[x]*` = partially complete (see row note for what's deferred) · `SKIP:` = not applicable for this repo type.

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (report email, supported versions, response timeline) (2026-02-27)
- [x] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required) (2026-02-27)
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output (2026-02-27)
- [x] `[all]` No telemetry by default — state it explicitly even if obvious (2026-02-27)

### Default safety posture

- [ ] `[cli|mcp|desktop]` SKIP: data/validation tools — no destructive actions
- [ ] `[cli|mcp|desktop]` SKIP: operates on local marketing data files only
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server

## B. Error Handling

- [x]\* `[all]` Errors use friendly try/catch envelopes (basic shape) — full Structured Error Shape (`code`, `message`, `hint`, `cause?`, `retryable?`) is **planned for v1.1** (2026-05-15)
- [ ] `[cli]` SKIP: not a CLI tool — validation scripts
- [ ] `[cli]` SKIP: not a CLI tool
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[desktop]` SKIP: not a desktop application
- [ ] `[vscode]` SKIP: not a VS Code extension

## C. Operator Docs

- [x] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions (2026-02-27)
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) (2026-02-27)
- [x] `[all]` LICENSE file present and repo states support status (2026-02-27)
- [ ] `[cli]` SKIP: not a CLI tool
- [ ] `[cli|mcp|desktop]` SKIP: data repo — no logging levels
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[complex]` SKIP: has comprehensive schema docs and examples

## D. Shipping Hygiene

- [x] `[all]` `verify` umbrella script — `npm run verify` runs `fmt:check && validate && lock:check && test` (added 2026-05-15)
- [x] `[all]` Version in manifest matches git tag (2026-02-27)
- [x] `[all]` Dependency scanning runs in CI — CodeQL workflow added in dogfood swarm wave 2 (2026-05-15)
- [x] `[all]` Automated dependency update mechanism exists — Dependabot config added in dogfood swarm wave 2 (2026-05-15)
- [ ] `[npm]` SKIP: package marked `"private": true` in package.json — source repo is GitHub-public, package is not published to npm
- [ ] `[npm]` SKIP: package marked `"private": true` in package.json — source repo is GitHub-public, package is not published to npm
- [ ] `[npm]` SKIP: package marked `"private": true` in package.json — source repo is GitHub-public, package is not published to npm
- [ ] `[vsix]` SKIP: not a VS Code extension
- [ ] `[desktop]` SKIP: not a desktop application

## E. Identity (soft gate — does not block ship)

- [ ] `[all]` SKIP: no logo — internal marketing data repo
- [ ] `[all]` SKIP: translations not applicable — data repo
- [ ] `[org]` SKIP: personal repo — no landing page
- [x] `[all]` GitHub repo metadata: description, homepage, topics (2026-02-27)

---

## Gate Rules

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification — don't leave it unchecked.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."
