# Releasing mcpt-marketing

This repo's `package.json` is marked `"private": true` — there is no `npm publish` step. Releases are GitHub-side: a version bump, a CHANGELOG promotion, a tag, a push.

This document is the checklist that turns implicit ritual into a verifiable sequence. Anyone with maintainer access should be able to follow it without consulting folklore.

---

## Pre-release checks

Run these locally first. CI will run them again, but a clean local pass shortens the round-trip:

```bash
npm install
npm test
npm run validate
npm run lock:check
npm run fmt:check
```

If any of these fail, **stop**. Fix the failure, commit, and re-run before continuing. The release sequence below assumes a green local build.

Then re-read [SHIP_GATE.md](SHIP_GATE.md). Every hard-gate row (sections A–D) must be `[x]` or `SKIP:`. If a row is unchecked, the release is not ready.

---

## Version-bump rules

| Bump  | When                                                                                                        |
| ----- | ----------------------------------------------------------------------------------------------------------- |
| Major | Breaking schema change (renamed/removed fields, structural shift) — `consumer-impact: yes` in the changelog |
| Minor | New feature, new tool added to the dataset, new optional schema field, new validator invariant              |
| Patch | Bug fix, documentation correction, internal refactor that does not change the consumer surface              |

When in doubt, prefer the higher bump. A minor that should have been a major creates downstream surprise; a major that should have been a minor costs nothing.

---

## Step-by-step release sequence

### 1. Bump the version in `package.json`

Edit the `version` field in `package.json`. Save.

### 2. Promote CHANGELOG `[Unreleased]` to the new version

In `CHANGELOG.md`:

- Change the `## [Unreleased]` heading to `## [X.Y.Z] - YYYY-MM-DD` (today's date in ISO 8601).
- Add a fresh, empty `## [Unreleased]` section above it.
- Verify each entry under the new version is accurate, deduplicated, and grouped under the right Keep-a-Changelog heading (Added, Changed, Deprecated, Removed, Fixed, Security, Deferred).
- If any entry has consumer impact (breaking schema change, removed field, contract shift), add `consumer-impact: yes` to the relevant bullet.

### 3. Re-run pre-release checks

```bash
npm test
npm run validate
npm run lock:check
npm run fmt:check
```

The version bump itself is exercised by `test/version.test.mjs`, which verifies that `package.json` and `CHANGELOG.md` agree on the current version. If this test fails, the bump or the changelog promotion is inconsistent.

### 4. Commit

Commit the version bump and changelog promotion together:

```bash
git add package.json CHANGELOG.md
git commit -m "chore(release): vX.Y.Z"
```

### 5. Tag and push

```bash
git tag vX.Y.Z
git push origin master
git push origin vX.Y.Z
```

The tag must match `vX.Y.Z` exactly — `test/version.test.mjs` and SHIP_GATE both expect this format.

### 6. Create the GitHub release

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-from-tag
```

Or use the GitHub UI — open the new tag, click "Create release," and paste the relevant section of CHANGELOG.md as the release notes. The CHANGELOG section is the canonical artifact; the GitHub release is a mirror.

### 7. Notify downstream consumers (when applicable)

If the release contains schema changes, breaking contract shifts, or new entities that downstream consumers (the public site, future generators) should re-vendor:

- Open an issue in the consumer repo referencing the release tag.
- Mention the `consumer-impact` flag in the issue title.

For routine patch releases with no consumer impact, no notification is needed — consumers re-vendor on their own cadence.

---

## Post-release verification

- The new tag appears at https://github.com/mcp-tool-shop/mcpt-marketing/tags
- The GitHub release is published and the changelog section is readable
- A clean clone at the new tag passes `npm install && npm test && npm run validate`
- `package.json`'s version matches the tag (the `test/version.test.mjs` invariant — true at every commit, but worth re-confirming at the tag)

---

## What about npm publish?

There is no npm publish step. `package.json` sets `"private": true` because:

- The repo is consumed by a sister repo (the public site bridge), not by an npm dependency graph.
- The contract is JSON files + a lockfile, not a JavaScript module API.
- Publishing to npm would create a second source of truth (the npm tarball) that could drift from the GitHub source. The lockfile + sha256 verification is designed to make GitHub-as-source unambiguous.

If this changes in the future (e.g., a CLI subset is published as `@mcptoolshop/marketir-tools` or similar), the npm publish step would be added here as part of the release sequence — after `git push --tags` and before `gh release create`.

---

## Hot-fix releases

For an urgent fix that cannot wait for the normal cadence:

1. Branch from the most recent release tag: `git checkout -b hotfix/X.Y.(Z+1) vX.Y.Z`
2. Apply the fix, commit, and run the full pre-release check suite.
3. Bump to the next patch version in `package.json` and promote the changelog entry.
4. Tag, push, and create the release as above.
5. Merge the hotfix branch back to `master` after the release.

The same SHIP_GATE.md check applies — a hotfix is still a release, and the hard-gate rows are still hard.
