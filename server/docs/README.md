# docs — server

Deep-dives for the `server` package (pipelines, diagrams, design notes).
`server/CLAUDE.md` links here via *Use when*.

- [`intent-layer.md`](intent-layer.md) — how a PR's intent is derived from its
  title, description, linked ticket and referenced plans/specs, cached per head
  SHA, and injected into the review prompt as untrusted context. Includes the
  confidence model and why intent can never suppress a finding.
- [`project-context.md`](project-context.md) — how repo markdown is discovered,
  attached to agents and skills, projected against an 8,000-token budget, and
  injected into the review prompt as untrusted context. Covers the containment
  + allow-list gate at every read, why the projection and a run's prompt agree
  exactly, and the two known bounds on a run's document reads.
