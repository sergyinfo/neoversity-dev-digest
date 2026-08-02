---
name: breaking-change
description: Flags removal or renaming of anything a caller can already depend on — routes, params, response fields, exported types, enum members.
---

# breaking-change

A change is breaking when code that worked against the previous version stops
working, **without the caller changing anything**. Judge by what a caller can
observe, not by whether the repo still compiles.

## Flag

- A route path, method, or required parameter removed or renamed.
- A response field removed or renamed.
- A field that was optional becoming **required** in a request.
- A field that was nullable becoming **non-nullable** in a request, or the reverse in a response.
- A type widened in a request or narrowed in a response (`string` → `"a" | "b"` on the way out).
- An enum member removed, or its wire value changed.
- A default value changed such that omitting the field now behaves differently.
- An exported symbol removed or renamed in a package other packages import.

Renaming both sides of an internal call is **not** breaking. Renaming a field that
crosses a network boundary or a package boundary **is**, even when every call site
in this repo was updated — the callers you cannot see were not.

## Do not flag

- Adding an optional request field.
- Adding a response field (unless the response is declared exact/strict).
- Internal refactors with no observable surface change.
- Renames confined to one module with no exported use.

## Report

Cite the exact `file:line` of the removal or rename, name the **old** and **new**
shape, and say who breaks: *"any client reading `user.name`"*, not *"this may
break clients"*.

## Bad

```diff
-  name: z.string(),
+  full_name: z.string(),
```
A response field was renamed. Every existing client reading `name` now gets
`undefined`. Breaking, even though this file compiles.

## Good

```diff
   name: z.string(),
+  /** @deprecated use `name`; removed in v3 */
+  full_name: z.string().optional(),
```
The new name is added alongside the old one and marked deprecated. Existing
clients keep working; new clients can migrate.
