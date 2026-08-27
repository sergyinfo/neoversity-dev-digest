# Retro ledger

Retrospectives on **how the SDD pipeline performed** — the spec → plan → implement → review →
verify chain itself, not the code it produced. Written by `/retro`, which runs **only when a
human types it**; nothing invokes it automatically.

**Scope boundary:** findings about the codebase — gotchas, conventions, library quirks — do
not belong here. They go to `<package>/INSIGHTS.md` via the `engineering-insights` skill. A
finding in the wrong home is lost to the reader who needs it.

**Append-only.** Newest entry first. An entry is never rewritten or deleted, including by the
run that wrote it — the record of what was proposed and declined is the point.

Each entry opens by checking the previous entry's proposals: were they applied, and did they
help? A ledger whose proposals nobody checks is a diary.

---

<!-- entries below, newest first -->
