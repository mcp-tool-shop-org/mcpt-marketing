<!--
This repo's thesis is that marketing claims should be falsifiable and evidence
should be hash-verified. PRs are the human entry point to that pipeline, so
they get the same shape: state the change, state how it could be wrong, state
how to confirm it isn't.

Delete sections that don't apply. Keep the headers you fill in.
-->

## Summary

<!-- 1–3 sentences: what this PR changes and why. -->

## Falsifiability check

<!--
The repo's thesis is falsifiable claims. Every PR should answer at least one of:

- If a claim was added or changed: what evidence (URL + content hash) backs it,
  and what observation would falsify it?
- If a script or schema was changed: what input would have produced the wrong
  answer before, and produces the right answer now?
- If only docs / CI / chore: write "n/a — no claim or behavior change" and
  explain briefly why.
-->

## Test plan

<!--
- [ ] `npm run fmt:check` passes
- [ ] `npm run validate` passes
- [ ] `npm test` passes (all suites)
- [ ] `npm run lock:check` passes
- [ ] CHANGELOG.md updated under `[Unreleased]` (or marked n/a)
- [ ] Any new claim has hash-verified evidence (or marked aspirational)
-->

## Linked issues

<!-- e.g., Closes #123, Refs #456. Delete if none. -->
