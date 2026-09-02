# Iteration 5 — the grader agent, run on the existing reports

No new executor runs. Six grader agents (`skill-creator/agents/grader.md`) were given
run-1 of each cell, the iteration-3 assertions, the fixture, and the answer key. Their
output went to `grading-agent.json` beside the existing hand grades, which were left
untouched. No transcripts were saved for those runs, so every process claim is marked
unverifiable — a gap in the runner, not the grader.

## Verdicts, against the hand grading

| cell | hand | grader agent |
|---|---|---|
| account-service, with_skill | 4/4 | 4/4 |
| account-service, without_skill | 3/4 | **2/4** |
| posts-search-export, with_skill | 4/4 | 4/4 |
| posts-search-export, without_skill | 3/4 | **2/4** |
| post-page, with_skill | 4/4 | **3/4** |
| post-page, without_skill | 3/4 | 3/4 |
| **totals** | with 100%, without 75%, **+0.25** | with 92%, without 58%, **+0.33** |

The direction survives a stricter grader. The absolute numbers do not: the hand grading
was more lenient in four of six cells.

## What the grader caught that neither the rubric nor the blind comparator did

**Every report checked contains at least one confidently stated, wrong claim.** Both
arms, all three cases. The graders executed the payloads rather than reading them.

- `?q=(a+)+++$` presented as the ReDoS demonstration — `new RegExp` throws
  `SyntaxError: Nothing to repeat`, so it never reaches mongod. Found independently in
  both arms of the posts case. The finding is real; the demonstration is not.
- The printed shell command in the command-injection finding cannot be produced by the
  code: `path.join` collapses `//`, so `https://attacker` becomes `https:/attacker`.
  Both arms print it, and both state one paragraph earlier that `path.join` normalises.
  The RCE lands anyway because curl tolerates the single slash — by luck, not reasoning.
- `?template=a&template=b` claimed to throw `TypeError` and 500 — an entire finding
  describing behaviour that cannot occur, since the value goes through a template
  literal and coerces to `a,b.html`.
- The fail-open finding in the account case: one arm says every downstream handler
  either touches `req.user` or sits behind `requireRole`, so the bug is "one route away"
  from a bypass. `GET /:id` in the file it just reviewed does neither.
- The other arm's fail-open finding claims a missing header "500s" — the 401 is already
  flushed, so finalhandler aborts and the client never sees a 500.
- `WWW-Authenticate` on a cross-origin image claimed to pop a basic-auth dialog —
  browsers stopped that years ago.

A finding can be correctly located, correctly severity-rated, cite the right line, carry
a working fix, and rest on a false premise. Nothing in three iterations could see this.

## Three attacks on the iteration-3 rubric, from the graders

1. **Assertion 2 ("no correct control filed as a finding") is the hinge of the whole arm
   comparison, and its wording gives out.** It never says whether a finding *at* a
   decoy's location for a *different* reason counts. The hand grading took the lenient
   branch every time — "an escape hatch that swallows any false positive a fluent
   reviewer can rationalize". Two graders reached FAIL where the hand grading reached
   PASS, on exactly this ambiguity.
2. **Assertion 3 ("no LOW in the findings list") is satisfiable by relabelling.** Two
   graders flagged it independently and produced examples: a finding whose own text says
   its impact is "privacy/integrity rather than code execution", filed MEDIUM. In one
   report a planted HIGH sits at MEDIUM alongside a promoted decoy — a decoy and a real
   click-to-XSS at the same level, and the rubric notices neither.
3. **Assertions 3 and 4 are formatting gates.** Any competent review passes them whether
   or not it found anything. Only assertion 1 does work, and it asks whether the bug was
   *named*, never whether the reasoning about it is right.

**Precision is asserted once, in undefined language, and never counted.** One report
scored 4/4 while reporting 5 findings for 3 plants with 2 decoys promoted — 60%
precision.

## Two defects in this eval's own artifacts

- **The hand grading's evidence field is boilerplate.** All 18 `grading.json` files in
  iteration 3 carry an identical evidence string for assertion 2, citing "missing
  iss/aud claims" (a case-4 detail) and "client-only sanitization" (a case-6 detail)
  regardless of the case being graded. Case-6 contains no JWTs at all. The verdicts rest
  on a real per-run check; the evidence attached to them does not describe the run. This
  is precisely what grader.md Step 3 requires and what the automation replaced with a
  template. Those files are under `results/` and never reached git.
- **The answer key was wrong about an index.** It described the ReDoS as running
  "against every indexed title"; `post.model.js` indexes only `author` and
  `isPublished`. One of the reviews was more accurate than the key it was graded
  against. Corrected.

## Proposed rubric for iteration 6

Converged recommendations from the six graders, none yet applied:

1. Make the decoy check mechanical: **no finding's cited location may fall inside a
   decoy's line range**, except in an explicitly-labelled not-a-finding section.
2. **Cap the findings list** (≤ 4, of which ≥ 3 are plants). Harder to game than a
   severity label.
3. **Severity ordering:** every plant rated HIGH or CRITICAL, and no non-plant rated at
   or above the lowest-rated plant.
4. **Executability:** any payload, shell command or runtime-error claim printed in a
   finding must behave as described when executed.
5. Save transcripts in the runner so process claims stop being unverifiable —
   `claude -p --output-format json` already returns `session_id`.

Items 1–3 change the gates and would invalidate the stored baselines, so they belong to
a new iteration rather than a patch of iteration 3.
