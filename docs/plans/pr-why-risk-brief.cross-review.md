# Cross-model review: PR Why + Risk Brief

**Plan:** `docs/plans/pr-why-risk-brief.md` · **Spec:** `server/specs/brief/01-pr-why-risk-brief.md` · **Date:** 2026-08-27
**Reviewed by:** `gemini-3.6-flash` (Google) · **Route:** automated, Gemini API, 43 320 input / 696 output tokens
**Verdict:** Sound enough to execute — with one confirmed divergence that the **spec**, not the plan, has to resolve first.

## What the reviewer was given, and what it was not

The full specification and the plan, minus the plan's own `Decisions taken`, `Requirements review`,
`Blocking questions` and `Recommendations` sections. Those record how the plan's authors reached
their conclusions; sending them would have told the reviewer what to think before it had judged.
It also received eight repository facts it could not infer — package layout, the two-copy
`vendor/shared` invariant, the fixed error envelope, generated migrations, and the absence of a
linter.

**Model caveat.** `gemini-3.6-flash` is a flash-tier model: `gemini-3.1-pro-preview` returned
`429 RESOURCE_EXHAUSTED` and every 2.5-series model returned
`404 … no longer available to new users`. A flash reviewer's **positive** finding is worth as much
as any other — it either holds against the text or it does not, and this one holds. Its blanket
"None" answers for categories (a), (b), (d) and (e) carry **less** weight than a pro-tier "None"
would, and should not be read as clearance.

## Findings

| # | Finding | Kind | Our verdict | Evidence |
|---|---|---|---|---|
| 1 | The read path cannot detect an edited linked issue or an edited referenced document, yet the spec requires exactly that. S7 splits the fingerprint into `local` and `remote`; S11's read path recomputes **only** `local`, so `GET /pulls/:id/brief` observes a match and serves the brief as current. | weak done-when | **confirmed** | Spec §6 *Freshness*, line 233: "Linked issue, or a referenced repository document, edited with no new commit → **the brief reads as out of date** and regeneration is offered". Spec REQ-14, line 157: "…differs from the fingerprint of **the current inputs**…". Plan S11, line 270: "recompute the **local** fingerprint only". The two cannot both be true. |
| — | (a) uncovered requirements | — | **cannot tell** | Reviewer reported none. All 15 REQs and 34 ACs are mapped in the plan's carried-AC table, which the reviewer could check structurally — but it could not check whether a step's *content* actually discharges its AC, having never seen the code. |
| — | (b) orphan steps, (d) ordering errors, (e) unnamed risks | — | **cannot tell** | Reviewer reported none in each category and gave a correct reading of the T0–T8 dependency chain. Accepted as far as it goes; a flash-tier "None" is not evidence of absence. |

## Applied to the plan

**None — plan unchanged.** Finding 1 is not a plan defect. The plan already names the consequence
in `## Risks & open questions` ("What BQ-1/A gives up, stated plainly"), and the trade-off was put
to the user and chosen deliberately: an edited issue or document is detected at the next
*generate*, not at the next *open*, in exchange for keeping the Overview read DB-only and inside
the spec's own 300 ms budget.

## Not applied — and what must happen instead

**The spec and the plan now disagree, and only the spec can fix it.**

The plan implements a narrowed REQ-14: "differs from the fingerprint of the current **local**
inputs". The spec, which is `approved` and which `plan-verifier` checks the work against, still
promises read-time detection for all ten fingerprint components — explicitly in its §6 *Freshness*
row and implicitly in REQ-14's "current inputs".

Left as it stands, the outcome is predictable: the work will land, and the verifier will grade
REQ-14 as **not met** against a spec sentence nobody amended — or, worse, grade it met and quietly
lower the bar the spec set.

**Required before `/impl`:** revise the spec through `/spec` — a revision of `01-`, not a new
number — so that

- **REQ-14** states that the out-of-date marker reflects the **locally recomputable** inputs, and
- **§6's *Freshness* row** for an edited issue or document says the change is detected at the next
  assembly rather than at the next read,
- with **D-1 amended** to record that this is what BQ-1/A traded away.

`AC-20` needs no change: it asserts that the fingerprint *differs* in all five cases, which stays
true — the plan tests all five directly against the fingerprint function, and S7's test is required
to record which two move only the `remote` half.

This note does not amend the spec. `/cross-review` may write only its own files.

## Provenance

- Request sent: `docs/plans/pr-why-risk-brief.cross-review-request.md` (152 KB — spec + plan +
  repository constraints + instruction). The specification and the plan were **published to
  Google** by this call; the provider may log and retain them.
- Raw response: `docs/plans/pr-why-risk-brief.cross-review-response.md`.
- The request file is fully reconstructible from the spec and the plan and may be deleted rather
  than committed.
