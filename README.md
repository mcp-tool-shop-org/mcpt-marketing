# mcpt-marketing

Deterministic marketing data layer for MCP Tool Shop. Schema-validated claims, hash-addressed evidence, and reproducible marketing builds.

Internally, the schema and IR layer is called **MarketIR** — a structured intermediate representation of tools, audiences, claims, evidence, messages, and campaigns.

## Ground Rules

These rules are non-negotiable. CI enforces them.

### IDs are stable and permanent

- IDs follow a namespace pattern: `tool.<slug>`, `aud.<name>`, `claim.<tool>.<slug>`, `ev.<tool>.<slug>.v<n>`, `msg.<tool>.<slug>`, `camp.<tool>.<slug>`
- IDs are **never renamed**. Deprecate instead (`status: "deprecated"`)
- All IDs must be unique across the entire graph

### Claims must declare status

Every claim has a `status`:

| Status         | Meaning                                  |
| -------------- | ---------------------------------------- |
| `proven`       | Backed by at least one `evidenceRef`     |
| `aspirational` | Believed true, evidence not yet captured |
| `deprecated`   | No longer valid — kept for audit trail   |

**Proven claims require evidence.** If a claim is `proven`, it must reference at least one entry in the evidence manifest. CI rejects proven claims with zero evidence.

### Evidence is hash-addressed

Every evidence artifact includes:

- `sha256` hash of the file content
- `bytes` size
- `provenance` object: who/what generated it, from which commit, and any notes

This makes evidence tamper-evident and reproducible.

### The lockfile is canonical

`marketing/manifests/marketing.lock.json` pins every included file by hash. CI regenerates the lockfile and fails if it differs from what's committed. This guarantees reproducible "marketing releases."

### Messages must trace to claims

Every message should be derivable from claims. If a message asserts something not represented as a claim, that's a schema violation enforced by validation.

### Deterministic serialization

All JSON files use:

- Stable key ordering (sorted)
- Stable array ordering (by ID)
- Trailing newline

This prevents "same data, different diff" noise.

## Repo Structure

```
marketing/
  schema/             # JSON Schema (2020-12) definitions
  data/
    tools/            # One file per tool
    campaigns/        # One file per campaign
    audiences/        # One file per audience
  evidence/           # Evidence artifacts (screenshots, reports)
  manifests/          # evidence.manifest.json + marketing.lock.json
  scripts/            # validate, hash, gen-lock
```

## Usage

```bash
npm install
node marketing/scripts/validate.mjs       # Schema + invariant checks
node marketing/scripts/gen-lock.mjs        # Regenerate lockfile
node marketing/scripts/gen-lock.mjs --check  # Fail if lock differs (CI mode)
```

## License

MIT
