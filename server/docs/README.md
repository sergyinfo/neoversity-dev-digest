# docs — server

Deep-dives for the `server` package (pipelines, diagrams, design notes).
`server/CLAUDE.md` links here via *Use when*.

- [`intent-layer.md`](intent-layer.md) — how a PR's intent is derived from its
  title, description, linked ticket and referenced plans/specs, cached per head
  SHA, and injected into the review prompt as untrusted context. Includes the
  confidence model and why intent can never suppress a finding.
