# Run: Eval Pipeline (L06)

Started: 2026-09-02 · Branch: `lesson-07/eval-pipeline` · Mode: multi-agent (T0–T5)
Plan: `docs/plans/eval-pipeline.md` · Spec: `specs/eval-pipeline.md` (approved)
Cross-review: `docs/plans/eval-pipeline.cross-review.md`

**Agent ceiling:** 10 (the plan's declared envelope). **Agents launched so far: 5** (T0, T3, T1, T4, T2a).
**Commit policy:** per stage. **doc-writer at the end:** yes (T5 is a plan track).
All Stage-0 decisions were taken as the recommended option, on the user's standing
instruction to proceed automatically.

## Stages

| # | Stage | Status | Artefact / result |
|---|---|---|---|
| 0 | intake & baseline | **done** | tree clean; design mockup committed; baseline fully green (801 tests) |
| 1 | implementation (T0–T5) | in progress | T0 done (+19 tests) · T3 done (+5) · T1 done (+37 unit, +13 integration) · T4 and T2a running |
| 2 | review (3 lenses) | not started | |
| 3 | fix loop (≤2 rounds) | not started | |
| 4 | verification (`plan-verifier`) | not started | |
| 5 | land | not started | |

## Baseline (pre-existing failures — never blamed on this change)

Captured before any file was touched.

| Check | Result |
|---|---|
| `reviewer-core` typecheck | **pass** |
| `server` typecheck | **pass** |
| `client` typecheck | **pass** |
| `e2e` typecheck | **pass** |
| `reviewer-core` unit suite | **pass** — 28/28 |
| `server` unit suite (excl. `.it.test.ts`) | **pass** — 474/474 in 35 files |
| `client` unit suite | **pass** — 191/191 in 26 files |
| `server` integration suite (`.it.test.ts`) | **pass** — 108/108 in 11 files, against a real Postgres via OrbStack. Required `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock`; see BL-1 below |

## Review findings

| # | Source | Severity | Finding | Round | Outcome |
|---|---|---|---|---|---|
| — | *(Stage 2 not started)* | | | | |

### Carried in from the cross-review — obligations, not findings

These were confirmed at `/cross-review` and are conditions on the tracks that own them.

| # | Obligation | Owner |
|---|---|---|
| CR-2 | The agent-snapshot `skills` shape deviates from the approved spec's Contracts section (`string[]` → objects). Say so in the PR description, alongside the `GET /agents/:id/eval-runs` addition | orchestrator, at Stage 5 |
| CR-3 | S8's Done-when must assert the mutation is actually invoked through `ReviewRunAccordion`, not merely that the button renders enabled | T3 |
| CR-4 | S9's Done-when must be its Test line — the `EvalsTab` suite green, not only the `AgentEditor` tab-switch assertion | T4 |
| CR-5 | A timed-out or failed run must surface as a recoverable state in the UI. Browser and proxy timeouts can cut a 50-case synchronous run even though Fastify sets none; the rows already written survive, so this is a display problem, not lost data | T1 (server semantics), T4 (display) |

### Found at Stage 0 — a baseline obligation

| # | Obligation | Owner |
|---|---|---|
| BL-1 | **The OrbStack shim in `verify-l03.sh:41-47` does not fire on this machine, and `verify-l06.sh` must not copy it verbatim.** Its condition requires `/var/run/docker.sock` to be ABSENT before it substitutes the OrbStack socket. Here that path exists — as a symlink to a dead Docker Desktop socket — so the condition is false, the shim stays silent, and the integration suites fail to start even though Docker is available and healthy (OrbStack 29.4.0). The failure is quiet: the script skips the checks rather than failing loudly, so `verify:l06` would report green for work that never ran. Probe the socket, do not test for the file's absence | T2 (writes `verify-l06.sh`) |

## Decisions

| Gate | Question | Answer |
|---|---|---|
| Stage 0 | Execution mode | multi-agent (T0–T5), as the plan recommends |
| Stage 0 | Commit policy | per stage |
| Stage 0 | Agent ceiling | 10 — the plan's declared envelope |
| Stage 0 | Run `doc-writer` at the end | yes — T5 is a plan track |
| Stage 0 | Untracked `docs/designs/` | committed, so worktree-isolated tracks can read the mockup T4's brief depends on |
| Stage 1 | Track T5 (`doc-writer`) — keep it? | **cancelled as a separate track.** The honest count came to 11 agents against a ceiling of 10: 5 spent, plus T2b, three review lenses, `plan-verifier`, and `doc-writer`. S14 splits cleanly instead — the `server/README.md` API map goes to T2b, and the `INSIGHTS.md` appends were always the orchestrator's, since the skill requires that pass to run **once** (parallel tracks appending to one append-only file collide). The three review lenses were NOT cut: `architecture-reviewer` does not look for logic errors by design and `/code-review` is forbidden from reporting boundary crossings, so merging them is the standard way this pipeline lets a defect through |

## Open at the end

*(filled at Stage 5)*
