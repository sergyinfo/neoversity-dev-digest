# Intent Layer — design notes

The Intent Layer (`server/src/modules/intent/`) derives a lightweight
classification of a PR's stated purpose — scope, confidence band, and any
linked issue or spec it references — from the diff and description alone. It
never changes a stored severity or a score; it is context only, delivered to
the reviewer as an `<untrusted source="pr-intent">` block.

This file is the **non-leading-segment** discovery case for `project-context`
(S18, D-2a): its own path is `server/docs/intent-layer.md`, so `docs` is the
*second* segment, not the first. A prefix-matching predicate — the kind
`isSafeRepoPath` already uses for the Intent Layer's own reference resolver —
would miss this file entirely, along with every other documentation
directory this repository actually has (`client/docs/`,
`reviewer-core/specs/`). `hasAllowedSegment` matches per path segment for
exactly this reason.

## Confidence bands

Confidence is a three-level band — `high`, `medium`, `low` — computed as the
minimum of the model's self-reported band and a deterministic evidence tier
derived from what was actually in the prompt: a linked spec earns `high`, a
linked issue or PR description earns `medium`, and an unlinked diff alone
earns `low`. The model may only ever lower the band, never raise it.
