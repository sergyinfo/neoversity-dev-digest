# Fix Brief — round 2

Source: R3 correctness findings 4 and 5. Both were held back from round 1 because
they are **contract-level**, not local defects, and the user decided the direction:
extend `BriefResponse` so the card can render what spec §6 requires.

Base: `c89c2d0` (fix round 1). Baselines to hold: server **393** unit + **60**
integration, client **137**. Nothing green may turn red.

**Out of scope:** the 8 000-token budget floor — the user chose to revise the spec
for that instead, and a separate `/spec` run is amending REQ-4 right now. Do not
touch `TOKEN_BUDGET`, `dropNext`, or the budget loop. No refactors beyond what the
two findings below require.

---

## F6 — Spec §6's two caveats are unrenderable, and two message keys are dead
- **Source:** R3 correctness, finding 4
- **Severity:** major (a `partial` index renders identically to a complete one)
- **Evidence:** `client/messages/en/brief.json:28,30` ship `fileCapped` ("Only the
  first {count} changed files were sent to the model.") and `partialCaveat`
  ("Based on a partial index, so some impact may be missing.") and **nothing
  references either**. Both correspond to spec §6 rows: the 300-file case says the
  card says the file list was capped, and the `partial` blast row says the brief
  carries the partial caveat "because a missing caller means a risk may be
  understated".
- **Why it cannot be rendered today:** `BriefResponse` carries no blast state and
  no capped-file signal, and `assemble.ts:339` records `blast` in `inputs_used`
  identically for `ok` and `partial`. So the one state where a risk really may be
  understated is invisible.
- **Done when:** the response carries enough to drive both caveats; the card
  renders each in the state that calls for it and in no other; and a test asserts
  a `partial` map renders the caveat while an `ok` map does not.
- **Shape is yours to choose**, but two constraints bind:
  - **`inputs_used` must keep meaning what it means.** Do not overload its
    membership to encode quality — a separate field is cleaner than `'blast:partial'`.
  - **Stored rows written before this change must still read.** `provenance` is
    nullable and `toResponse` already tolerates a parse failure. A new required
    field in `BriefProvenance` would make every existing row unreadable — see F7,
    which is about exactly that failure mode.

## F7 — Unreadable provenance is collapsed into "impact is unknown"
- **Source:** R3 correctness, finding 5
- **Severity:** minor, fixed with F6 because it is the same banner
- **Evidence:** `server/src/modules/brief/service.ts:531-539` falls back to
  `inputs_used: []` when `BriefProvenance.safeParse` fails, and the card derives
  `impactUnknown = !data.inputs_used.includes("blast")` (`WhyRiskCard.tsx:107`).
  A brief whose `provenance` column is null — the schema permits it, and the
  comment in `db/schema/reviews.ts` says a pre-widening row still reads — or whose
  shape has drifted therefore renders "Impact is unknown — this repository is not
  indexed." over a brief assembled from a healthy `ok` map.
- **Three distinct states reach one banner:** no blast, degraded blast, and
  provenance unreadable. The third is a *we don't know what this brief used*, not
  a *we know it had no impact map*.
- **Done when:** an unreadable or absent provenance is distinguishable from a
  known-degraded one in the response, the card does not assert a fact about the
  index when it does not have one, and a test covers the null-provenance row.

---

## Verification
- `cd server && pnpm typecheck` · `cd client && pnpm typecheck`
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot`
- `cd server && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock pnpm exec vitest run .it.test --reporter=dot`
  — without `DOCKER_HOST` these fail rather than skip
- `cd client && pnpm test -- --reporter=dot`
- `diff -rq server/src/vendor/shared client/src/vendor/shared` must print nothing

There is no linter in this repo.

**Push back with evidence** on anything you believe is wrong rather than fixing it
quietly — that moves it to `contested` and the user decides.
