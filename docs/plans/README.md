# plans

Implementation plans written by `/plan` (see `.claude/agents/implementation-planner.md`),
one file per feature: `<feature>.md`. A plan records the requirements review, the answered
blocking questions, the accepted recommendations, the steps with their verification
commands, and the chosen execution mode — so `plan-verifier` can check the finished work
against the plan that was actually agreed.

Plans are point-in-time records. A landed feature's durable documentation belongs in
`<package>/docs/` (written by `doc-writer`); a gotcha belongs in a package `INSIGHTS.md`.
