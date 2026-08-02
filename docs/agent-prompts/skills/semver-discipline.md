---
name: semver-discipline
description: Decides which version bump a change requires, and flags a PR whose version does not match what it actually did.
---

# semver-discipline

The version is a promise about upgrade safety. A PR that breaks a contract
without a major bump makes that promise a lie for every consumer running a
caret range.

## The rule

| Change | Bump |
|---|---|
| Anything a caller can observe **stops working** | **major** |
| New capability, existing behaviour unchanged | minor |
| Fix that makes behaviour match its documented contract | patch |

Pre-1.0 (`0.x`) shifts each one down: breaking → minor. Say so explicitly rather
than silently applying a different rule.

## Flag

- A breaking change (see `breaking-change`) with no major bump in the same PR.
- A version bumped in `package.json` that does not match the change: a major for a typo fix erodes the signal as surely as a patch for a removal.
- A new exported symbol or endpoint with only a patch bump.
- A behaviour change presented as a "fix" when callers depended on the old behaviour — a bug fix that anyone relied on is breaking.
- A monorepo package changed with no bump at all, when its siblings are versioned.

## Do not flag

- Internal-only packages marked `private: true` that nothing outside the repo consumes.
- A version left alone in a repo that versions on release rather than per PR — check for a changelog or release workflow before assuming.

## Report

Name the change, the bump it requires, and the bump the PR made:
*"removes `GET /v1/users/:id/roles`; requires major, PR bumps 2.4.1 → 2.4.2."*

## Bad

```diff
-  "version": "2.4.1",
+  "version": "2.4.2",
```
…in a PR that deleted a public route. Consumers on `^2.4.0` pick this up
automatically and break on deploy.

## Good

```diff
-  "version": "2.4.1",
+  "version": "3.0.0",
```
…with the removal listed under a `BREAKING` heading in the changelog. Consumers
on `^2` stay put until they choose to migrate.
