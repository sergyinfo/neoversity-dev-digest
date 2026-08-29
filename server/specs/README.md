# specs — server

Agreed requirements / acceptance criteria for the `server` package, one folder per module,
holding a numbered series of specs: `<module>/NN-<slug>.md` (`01-`, `02-`, … following the
`e2e/specs` precedent). A spec states WHAT and WHY — requirements, acceptance criteria,
corner cases, workflow, module communication, contract expectations — and never HOW; steps
and files are `implementation-planner`'s output in `docs/plans/`. Written by `/spec`; see
`.claude/agents/spec-creator.md`. Numbers are never reused or renumbered.

## Index

| Spec | Status | Covers |
|---|---|---|
| [project-context/01-project-context.md](project-context/01-project-context.md) | approved | Attaching repository markdown to agents and skills, token estimates and budget, injection into the review prompt, and the per-run record in Prompt Assembly |
| [brief/01-pr-why-risk-brief.md](brief/01-pr-why-risk-brief.md) | approved | The Why & Risk card: assembling a PR brief from five grounded inputs in one model call, the state fingerprint that makes re-opens free, and click-through from review focus into the diff |
