# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

## Scope

mcpt-marketing is a **MarketIR infrastructure** project — deterministic marketing with falsifiable claims and hash-verified evidence.

- **Data touched:** Marketing claim/evidence JSON files (local), lock files with SHA-256 hashes
- **Data NOT touched:** No user data, no credentials, no databases, no external services
- **Permissions:** Read/write: marketing data files in repo. No filesystem access beyond repo.
- **Network:** None — fully offline validation and generation tools
- **Telemetry:** None collected or sent

## Reporting a Vulnerability

Use GitHub's **private vulnerability advisory** feature for this repo:

**[github.com/mcp-tool-shop/mcpt-marketing/security/advisories/new](https://github.com/mcp-tool-shop/mcpt-marketing/security/advisories/new)**

This is the supported intake channel — the address listed in earlier versions of this file was a GitHub no-reply forwarder that does not accept inbound mail.

When opening an advisory, include:

- Description of the vulnerability
- Steps to reproduce
- Version affected
- Potential impact

### Response timeline

| Action             | Target   |
| ------------------ | -------- |
| Acknowledge report | 48 hours |
| Assess severity    | 7 days   |
| Release fix        | 30 days  |
