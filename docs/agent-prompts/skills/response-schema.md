---
name: response-schema
description: Flags changes to the SHAPE of a response — types, nullability, required-ness, enum sets — including the subtle ones that keep compiling.
---

# response-schema

The response schema is a contract. Narrowing what you promise to return, or
loosening what a caller must handle, breaks people quietly — the code compiles,
the tests pass, and a client falls over in production.

Read every schema diff twice: once for what was added, once for **what a caller
was previously guaranteed and no longer is**.

## Flag

- A response field losing `.optional()` or `.nullish()` — callers that handled `undefined` are fine, but generated clients and strict parsers change shape.
- A response field **gaining** `.optional()` or `.nullable()` — this is the dangerous direction. Callers that safely did `res.total.toFixed(2)` now crash on `undefined`.
- A type narrowed on the way out: `string` → an enum, `number` → a literal union.
- An enum member removed from a response union.
- A field changing type at all: `string` → `number`, scalar → object, object → array.
- A list response becoming paginated (or the reverse) — the top-level shape changed.
- `passthrough()` → `strict()`, which starts rejecting payloads that used to work.

## The direction that gets missed

Making a response field optional or nullable reads like a *relaxation*, so it
slips through review. It is not. On the way **out**, optional is strictly worse
for the caller: they were promised a value and now must handle its absence.

Requests are the mirror image — optional is safe, required is breaking.

## Report

State the field, the old and new shape, and the concrete caller failure:
*"`total` becomes nullable; a client doing `total.toFixed(2)` throws on any row
without one."*

## Bad

```diff
-  total: z.number(),
+  total: z.number().nullable(),
```
Every caller was promised a number. They now get `null` sometimes, with no
version bump and no note. Compiles, ships, breaks a dashboard.

## Good

```diff
-  total: z.number(),
+  /** null when the aggregate is suppressed; see MIN_N */
+  total: z.number().nullable(),
```
…paired with a major version bump and a changelog entry. The nullability is
deliberate, documented, and announced.
