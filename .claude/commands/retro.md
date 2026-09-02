---
description: Manual retrospective on how the SDD pipeline itself performed — what worked, what cost more than it should, where a stage went silent — with concrete proposals. Appends one entry to docs/retro/ledger.md. Never runs on its own.
argument-hint: [deep] [--since <date|ref>] [--scope <feature>]
allowed-tools: Task, Read, Grep, Glob, Write, Edit, Bash(date:*), Bash(ls:*), Bash(mkdir:*), Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(git status:*)
disable-model-invocation: true
model: opus
---

# /retro — retrospective on the pipeline

Request: **$ARGUMENTS**

## This runs only when a human types it

`disable-model-invocation: true` is set so the model cannot summon this on its own, and
nothing in the repo's session protocol calls it. **Do not add it to one.** A retrospective
that fires automatically stops being a decision and becomes noise in every session.

If you arrived here because a session was "wrapping up" rather than because the user typed
`/retro`, stop and say so.

## What this is, and what it is not

| This | Not this |
|---|---|
| **Process**: how the spec → plan → implement → review → verify pipeline performed | **Codebase**: gotchas, conventions, library quirks — those are `engineering-insights` → `<package>/INSIGHTS.md` |
| Where tokens went, what got redone, which stage reported success it had not earned | A summary of what the feature does |
| Proposals for the agent and command prompts, with a way to tell whether they worked | Applying those proposals — that is the user's call, made separately |

**The boundary is load-bearing.** If a finding is about the code, it does not belong in the
ledger — hand it to `engineering-insights` instead and say you did. If a finding is about how
the work was done, it does not belong in `INSIGHTS.md`. A finding filed in the wrong home is
lost to the reader who needs it.

## Sources

**Default — the current session's context.** What you already have: which agents ran, what
they returned, what had to be redone, what the user corrected.

**`deep` — also read the artefacts, and delegate the reading.** `docs/plans/*.run.md` (run
logs with their findings tables), the plans themselves, the specs, `git log` and diffs over
the period, and **every previous ledger entry**. These are large: read them through a
subagent and keep only its conclusions, or the retrospective becomes the thing it is
criticising.

Scope defaults to since the last ledger entry. `--since` and `--scope` narrow it.

## Step 1 — check the last entry's proposals first

Before analysing anything new, read the most recent ledger entry and answer, for each
proposal it made: **was it applied, and did it help?** Evidence, not impression — a changed
prompt file, a run log showing fewer rounds, a token count.

A ledger whose proposals nobody checks is a diary. This step is what makes it a ledger, so it
comes first and is never skipped. If the previous entry's proposals were not applied, say so
plainly and do not silently re-propose them.

## Step 2 — analyse

Ground every observation in something you can point at — a run log line, a returned report, a
file, a diff. "It felt slow" is not an observation; "the review stage ran three times over the
same diff because test-writer landed after it" is.

Look for:

- **Rework loops** — the same thing done twice. Which stage produced work another stage undid?
- **Token sinks** — where the cost was concentrated, and whether the signal justified it.
- **Silent stages** — anywhere a stage reported success it had not earned, or reported nothing
  when something was skipped. These are the most expensive findings, because they teach the
  reader to trust something that lied.
- **Wrong-agent moments** — work done by an agent whose charter did not cover it, or a
  question asked of the wrong one.
- **Gates that did not gate** — an approval that was a formality, a check that could not fail.
- **What worked, with evidence** — a retro that only finds faults trains the reader to
  discount it. Name what to keep, and why it worked.

## Step 3 — propose

Every proposal carries all five, or it is not a proposal:

| Field | Meaning |
|---|---|
| Change | The concrete edit, and **which file** it lands in — an agent prompt, a command, a convention |
| Because | The observation from Step 2 it answers, by reference |
| Cost | What it makes slower, longer, or more rigid. Every proposal has one; "none" means you have not looked |
| Expected effect | What should measurably differ next run |
| How we'd know | The check the *next* retro will run against it |

Grade each **adopt now / try once / park**. Parked proposals stay in the ledger; they are the
record of what was considered and declined, which is how the same idea stops being
re-litigated every retro.

**You do not apply proposals.** Not one. Report them, write them to the ledger, and stop —
the user decides what changes.

## Step 4 — write the entry

Append to `docs/retro/ledger.md`. **Append-only: never rewrite or delete an existing entry**,
including your own from an earlier run. Newest entry goes at the top, under the header.

```markdown
## <YYYY-MM-DD> — <scope>

**Mode:** context | deep · **Period:** <since>…<until> · **Read:** <what deep actually opened>

### Previous proposals
| From | Proposal | Applied? | Did it help? | Evidence |
|---|---|---|---|---|

### Observations
| # | Observation | Kind | Evidence |
|---|---|---|---|
<Kind: rework / token sink / silent stage / wrong agent / weak gate / worked well>

### Proposals
| # | Change | File | Because | Cost | Expected effect | How we'd know | Grade |
|---|---|---|---|---|---|---|---|

### Handed elsewhere
<Codebase findings passed to `engineering-insights`, named. "None" is valid.>
```

If `docs/retro/ledger.md` does not exist, create it with the header from `docs/retro/`'s
convention and add the first entry beneath.

## Step 5 — report in chat

The same content, in the user's language, ordered by what they can act on: previous proposals
first (did the last round work?), then the two or three observations that matter, then the
proposals graded **adopt now** — with the one you would do first named explicitly.

Say plainly if the honest answer is "nothing substantial this period". A retro that
manufactures findings to justify having run is worse than a short one.

## Boundaries

- **Append to `docs/retro/ledger.md` and nothing else.** Never `INSIGHTS.md`, never an agent
  prompt, never a command file, never source.
- **Never apply a proposal in the same run that made it.**
- **Never invoke `engineering-insights` yourself** to file the codebase findings — list them
  and let the user run it, so the two records stay under separate, deliberate decisions.
