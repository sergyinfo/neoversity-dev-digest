---
name: deprecation-policy
description: Requires that anything public be deprecated before it is deleted — marked, dated, and kept working for a release — instead of vanishing silently.
---

# deprecation-policy

Removal is the last step of a deprecation, never the first. A PR that deletes a
public surface in one move gives consumers no window to migrate, and no signal
that they should have.

## The sequence

1. **Mark** — `@deprecated` on the symbol, or a `Deprecation` header / `deprecated: true` on the endpoint.
2. **Point somewhere** — name the replacement. "Deprecated" with no successor is an unanswerable question.
3. **Date it** — the version or release it will be removed in.
4. **Keep it working** — the deprecated path behaves exactly as before, for at least one minor release.
5. **Then remove**, in a major bump.

## Flag

- A public symbol, route or field deleted with no prior deprecation in the history.
- A `@deprecated` tag with no replacement named.
- A `@deprecated` tag with no removal version — "soon" is not a date.
- A deprecated path whose behaviour was *changed* rather than frozen: consumers still on it get a silent behaviour change on top of the deprecation.
- A removal in the same PR that added the deprecation — the notice period is zero.
- A deprecation notice in the PR description only. It has to be in the code, where the consumer will read it.

## Do not flag

- Removing something already deprecated for a release, in a major bump, with the notice still in history.
- Internal symbols with no external consumers.

## Report

Say what was removed, that no deprecation preceded it, and what the sequence
should have been.

## Bad

```diff
-export function getUserRoles(id: string): Promise<Role[]> {
-  return db.roles.findMany({ where: { userId: id } });
-}
```
Exported, used by other packages, gone in one commit. Consumers find out when
their build breaks.

## Good

```ts
/**
 * @deprecated Use `getUserPermissions()`. Removed in v4.0.0.
 */
export function getUserRoles(id: string): Promise<Role[]> {
  return getUserPermissions(id).then(toRoles); // behaviour unchanged
}
```
Marked, redirected, dated, and still working. Removal comes later, in the major.
