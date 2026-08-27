---
description: Write or revise the WHAT/WHY specification for one DevDigest module — runs the specreator agent, settles its blocking questions with you, then persists the spec as <package>/specs/<module>/NN-<slug>.md for implementation-planner to consume
argument-hint: <feature> [in <package>/<module>]
allowed-tools: Task, AskUserQuestion, SendMessage, Read, Write, Edit, Glob, Grep, Bash(date:*), Bash(ls:*), Bash(mkdir:*), mcp__claude-in-chrome__gif_creator
model: opus
---

# /spec — create or revise a module specification

You are the thin wrapper around the `specreator` agent. The agent thinks and cannot write;
**you are the only thing that touches the filesystem**, and the only path you may write is
`<package>/specs/<module>/`. If you ever find yourself about to write anywhere else, stop
and report it instead.

Request: **$ARGUMENTS**

## 1. Prepare the agent's inputs

Do these yourself before spawning anything — the agent has no `Bash`:

- Today's date: `date +%F`. The agent must never guess a date; it lands in `updated:`.
- Target guess: package + module from the request. Don't over-invest — the agent
  re-derives it and will flag an ambiguity as a blocking question.
- **Numbers already taken:** `ls <package>/specs/<module>/` once the target is clear. Pass
  the list. Specs are a numbered series per module (`01-…`, `02-…`, following the
  `e2e/specs` precedent); the next one takes the next free number and **never reuses or
  renumbers an existing file**, because plans and commits cite these paths.
- Designs: `client/specs/*.html` (committed bundles). Pass the absolute `file://` paths.

## 2. Run the agent

Spawn `specreator` (`subagent_type: "specreator"`) with: the feature request verbatim,
today's date, the target guess, the numbers already taken, and the design paths. Ask for
its three sections — spec body, blocking questions, handoff.

**Do not write anything yet.**

## 3. Settle the blocking questions

If section B is non-empty, relay the questions to the user with `AskUserQuestion` — up to
four per call, batched, each option carrying the agent's recommendation. Keep the agent's
wording; you are a relay, not an editor. Ask in the user's language even though the spec
itself is English.

Then `SendMessage` the answers back to the **same** agent — it has the full context and
returns the final spec body. Never patch the spec body yourself: a spec edited by the relay
diverges from the reasoning that produced it.

If the user answers "as you recommend" to everything, still send the answers back — the
agent must record them in `## 13. Decisions`.

## 4. Persist

Only now:

1. `mkdir -p <package>/specs/<module>` — create `<package>/specs/` first if the package has
   none.
2. `Write` the section-A body **verbatim** to `<package>/specs/<module>/NN-<slug>.md`, with
   `NN` the next free two-digit number in that folder.
3. When this spec supersedes an earlier number, confirm every `## 13. Decisions` row from
   that file survived, and that its frontmatter `supersedes:` names it. Then set the older
   file's frontmatter `status:` to `superseded` — that is the **only** edit you may make to
   it. **Never delete or rewrite a superseded spec** — the series is a history.
4. Update `<package>/specs/README.md`: index the new spec, and **delete the "Empty for
   now." line** if it is still there. A stub claiming emptiness while holding specs is
   worse than either state.

Only `.md` files may be written under `specs/` — a hook enforces this, and `e2e/specs/`
`.flow.json` files are not yours to touch.

**Visual evidence, if the user wants it:** there is no tool that saves a Chrome screenshot
straight to disk. Record the design walkthrough with `gif_creator` into
`<package>/specs/<module>/assets/` instead, and link it from the spec's `Sources`. Skip this
by default — the `design:` frontmatter plus named screens in `Sources` is enough to
reproduce what the agent saw.

## 4b. Research the agent could not run itself

The agent delegates unknowns to `researcher` subagents. If its handoff says nested spawning
was unavailable, **run those questions yourself** before persisting — one `researcher` per
question, in parallel — and send the findings back to the agent so they land in `## Sources`
rather than in `## 14. Assumptions`. Dropping them silently turns an open question into an
invented fact.

## 5. Report

Tell the user, in their language:

- the path written, and whether it supersedes an earlier number
- the count of requirements and acceptance criteria
- **the corner cases the design did not answer** — the most valuable output of the run
- UX findings by severity, blockers first
- open questions still unsettled — these become `implementation-planner`'s blocking
  questions, so name who can settle them
- the agent's **final self-check** result: any line that came back `n/a`, and why
- **insight candidates** from the handoff — offer to record them with `engineering-insights`
- the next step: read the spec and, if you agree with it, set its frontmatter `status:` to
  `approved` — `/plan` **refuses to plan a `draft`**, and approving is a human decision, not
  something this command or `/plan` does for you

## Boundaries

- **Never plan or implement.** If the user asks "and now build it", hand off to `/plan`; do
  not extend the spec with steps, file paths, or code blocks. A contract in a spec is a
  table of fields and meanings — never source.
- **Never write outside `<package>/specs/`.** Not `docs/`, not `docs/plans/`, not
  `INSIGHTS.md` (append-only, owned by `engineering-insights`), not source.
- **Never invoke `implementer` or `test-writer`** from here.
