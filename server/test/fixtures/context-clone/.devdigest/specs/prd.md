# PRD — Payments API public endpoints

This is the product spec `.devdigest/specs/` exists to hold — a plan document
a PR is expected to reference, resolved by the Intent Layer's own reference
resolver (`intent/references.ts`) when linked, and separately discoverable
here as project context (S18, AC-4 — the leading-path-prefix predicate).

`.devdigest/specs` is a **two-segment** path and is matched as a leading
*prefix* (`hasAllowedPrefix`), not a per-segment allow-list entry — putting it
in `CONTEXT_DOC_DIR_SEGMENTS` instead would silently match nothing, because no
single path segment ever equals the two-segment string `.devdigest/specs`
(cross-review F2).

## Requirements

1. Public endpoints are rate limited per client key.
2. Every inbound webhook is signature-verified against the raw body.
3. The user-list endpoint must not issue one query per row.
