---
description: Have a model from a different family review an implementation plan independently, then record what it found — and what survived our own check — as docs/plans/<feature>.cross-review.md. Runs between /plan and /impl.
argument-hint: [--plan <path>] [--via openrouter] [--response <path>]
allowed-tools: AskUserQuestion, Read, Write, Edit, Glob, Grep, Bash(date:*), Bash(ls:*), Bash(cat:*), Bash(curl:*)
model: opus
---

# /cross-review — an independent read of the plan

Request: **$ARGUMENTS**

A plan reviewed only by the family that wrote it inherits that family's blind spots. This
stage exists to break that, and it is worth nothing unless the other model is **genuinely
independent** — which means it must not see our reasoning, our recommendations, or which
options we already rejected.

Runs **after `/plan`, before `/impl`**. The note is committed with the plan, ahead of any
feature code.

## 1. Resolve the plan

`--plan <path>`, or the newest `docs/plans/*.md` that has no `.cross-review.md` beside it.
Read it, and read the spec it was written against — the reviewer needs the requirements to
judge the plan against something.

## 2. Build the review request

Write `docs/plans/<feature>.cross-review-request.md` containing, in this order:

1. The spec body (the agreed WHAT/WHY).
2. The plan verbatim.
3. The repo constraints a stranger cannot infer: four standalone packages, not a workspace;
   the two `vendor/shared` copies that must stay byte-identical; `reviewer-core` does no I/O;
   validation is Zod, and the error envelope is fixed; migrations are generated, never
   hand-written; there is **no linter**.
4. This instruction, verbatim:

> Review this implementation plan against the specification it claims to satisfy. You have
> not seen the codebase — do not guess at what the code looks like, and say so where it
> matters. Report only: (a) requirements in the spec that no plan step covers; (b) plan steps
> that satisfy nothing in the spec; (c) steps whose "Done when" could pass while the
> requirement still fails; (d) ordering or dependency errors; (e) risks the plan does not
> name. For each, give the requirement or step ID. **Do not propose a different design, and
> do not rewrite the plan.** If the plan is sound, say so — "no findings" is a valid answer.

**Include nothing about how we arrived at the plan** — no recommendations we accepted or
rejected, no blocking questions and their answers, no notes from this session. Anchoring the
reviewer on our reasoning is exactly the failure this stage is meant to avoid.

## 3. Get the review

**Manual (default).** Tell the user the request file is ready and to paste it into a model of
another family — GPT, Gemini, whatever they have — then hand the answer back with
`--response <path>` or pasted into the chat. This is the default because no provider key is
configured in this repo, and because it keeps the choice of model with the user.

**Automated (`--via openrouter`).** Only when `OPENROUTER_API_KEY` is set in the environment,
and only after the user confirms **in this run**. Sending the plan and spec to an external
service publishes them — they may be logged or retained by the provider regardless of what
happens afterwards. Name the model you intend to use before calling, and never pick a Claude
model: same family, no independence, no point.

If neither path is available, stop and say so. **Do not review the plan yourself and present
it as a cross-model review** — a note that claims independence it does not have is worse than
no note.

## 4. Judge the findings before recording them

An independent reviewer that has not seen the code will produce some findings that are wrong
here. Take each one and mark it:

- **confirmed** — real; name what in the spec or plan proves it
- **rejected** — wrong, with the reason and the `file:line` or plan step that refutes it
- **cannot tell** — plausible, needs a look at code the reviewer did not have

Rejecting a finding is a normal outcome and must carry evidence, not an opinion. A note where
everything is confirmed usually means nobody checked.

## 5. Write the note

`docs/plans/<feature>.cross-review.md`:

```markdown
# Cross-model review: <feature>

**Plan:** <path> · **Spec:** <path> · **Date:** <YYYY-MM-DD>
**Reviewed by:** <model and family> · **Route:** manual paste | openrouter
**Verdict:** <one line — is the plan sound enough to execute?>

## Findings
| # | Finding | Kind | Our verdict | Evidence |
|---|---|---|---|---|
<Kind: uncovered requirement / orphan step / weak done-when / ordering / unnamed risk>

## Applied to the plan
<Which confirmed findings changed the plan, and how. "None — plan unchanged" is valid.>

## Not applied
<Confirmed findings deliberately left, with the reason. These become risks, not silence.>
```

Then, for every **confirmed** finding: either amend the plan through `/plan` — never by hand
here — or record it in the plan's `## Risks & open questions`. A confirmed finding that
changes nothing and is written nowhere is a finding you have thrown away.

## 6. Report

The verdict, the count by kind, the confirmed findings in order of severity, and what you
recommend doing before `/impl`. Say plainly if the honest answer is "no findings".

## Boundaries

- **Write only `docs/plans/<feature>.cross-review*.md`.** Never the plan, never the spec,
  never source.
- **Never pass this off as independent if it was not.** Route and model go in the note.
- **Never send anything externally without explicit confirmation in this run.**
