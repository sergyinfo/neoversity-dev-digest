# Fix Brief — round 1

Source reviews: R2 (architecture, no findings), R3 (correctness), R4 (security).
Diff under fix: `b5cd777..HEAD`. Baseline is green — server 31 files / 382 unit
tests + 9 files / 59 integration, client 21 files / 133.

**Out of scope: everything not listed here.** No refactors, no renames, no
"while I'm here". Two further findings are design-level and are being decided by
the user separately — do not touch them: the §6 `fileCapped`/`partialCaveat`
caveats, and the 8 000-token budget floor.

---

## F1 — The linked issue is matched by suffix, so another repo's issue wins
- **Source:** R3 correctness, finding 1
- **Severity:** major
- **Evidence:** `server/src/modules/brief/service.ts:476-493`. `issueRef` is
  correctly narrowed to a same-repo `#N`, but `issueContent` is then found with
  `r.source.endsWith('#' + issueRef?.issueNumber)`, which ignores the
  `owner/repo` half of the source set at `intent/references.ts:288`.
  `parseReferences` emits GitHub-URL refs *before* short `#N` refs, so a
  foreign-repo reference sorts first and is picked.
- **Failure scenario:** PR body `"Closes #123. Upstream: https://github.com/other/repo/issues/123"`
  in repo `acme/web` → `issueRef = acme/web#123` but `issueContent = other/repo#123`.
  The prompt's `## Linked issue #123` block then carries the *other* repo's title
  and body, the real issue is demoted to a plain reference document, and the
  fingerprint's `linked_issue` component digests the wrong text — so editing the
  actual linked issue no longer moves that component.
- **Done when:** the match is an equality check on the full source, a test covers
  the two-reference ordering above, and the `linked_issue` fingerprint component
  is proven to move when the *same-repo* issue text changes in that scenario.

## F2 — `generated_at` is never rendered
- **Source:** R3 correctness, finding 2
- **Severity:** major
- **Evidence:** `grep -rn generated_at client/src` finds it only in two test
  fixtures. `WhyRiskCard.tsx:282-317` renders model, cost, tokens and the
  regenerate button, and nothing else.
- **Why it is load-bearing, not decorative:** spec §10's field table marks it
  Required **yes** ("Show '—'; never 'just now'") and F-9 says to place it where
  the user can see how old the brief is. D-1a accepts that an edited linked issue
  or reference document leaves the card reading as *current*, and names
  `generated_at` and the provenance list as the only two things that date the
  brief. With neither shown, the accepted cost has no mitigation at all.
- **Note:** the server is already correct — `service.ts:547` handles a null
  `generatedAt`. Only the render is missing. The plan's card description
  (`docs/plans/pr-why-risk-brief.md:302`) omits it too, which is how it was lost.
- **Done when:** the footer renders it, a null value renders `—` and never a
  relative phrase like "just now", and a test covers both.

## F3 — `file:line` file_refs are silently discarded, and the prompt teaches the model to write them
- **Source:** R3 correctness, finding 3
- **Severity:** major
- **Evidence:** `grounding.ts:136` matches `file_refs` by exact membership in an
  allow-list of **bare** paths (`:79-98`). But the dependency map shown to the
  model renders callers as `called from src/server.ts:12 (bootstrap)`
  (`blast/summary.ts:76`), and the system prompt says only that a reference "may
  name any path that appears in the changed-file list or in the dependency map" —
  never that it must be bare. A model copying a caller reference writes
  `src/server.ts:12`, which is discarded whole and counted into `discarded_refs`.
- **Three places in the diff assume the opposite:** `splitFileRef`
  (`WhyRiskCard/constants.ts:83-94`) exists to parse `path:line` out of a
  `file_refs` entry and its comment claims "the assembler emits both"; the seeded
  `pr_brief` ships `file_refs: ['src/config.ts:12']` and two more — values the
  server's own grounding would reject, so the demo shows navigation production
  cannot produce; and no test covers a `path:line` `file_ref` in either package.
- **Done when:** the three agree. Split the `:line` suffix before matching is the
  expected direction, since the seed and the client already assume it and the
  prompt cannot stop a model copying from the map. Whichever direction you take,
  fix all three and add the missing test.

## F4 — `review_focus[].line` is never grounded but is documented as guaranteed
- **Source:** R4 security, finding 1 (pairs with F3 — same defect class, same file)
- **Severity:** major (R4 filed it minor; it is being fixed with F3 because the
  two share the grounding pass and a fix to one without the other leaves the file
  half-guaranteed)
- **Evidence:** `grounding.ts:130-134` filters review-focus entries on
  `entry.file` alone; `line` passes through untouched. The system prompt
  (`constants.ts`, BRIEF_SYSTEM_PROMPT) requires the line to fall inside one of
  that file's `@@` ranges, and `client/src/lib/hooks/brief.ts:59-62` asserts to
  every future reader that "`line` always sits inside a hunk at the PR head —
  grounding guarantees both". It does not.
- **Why it matters:** `reason` is fully model-controlled prose rendered beside a
  *grounded* path, so it borrows that path's credibility. `hunkRanges()` already
  computes exactly the ranges needed (`assemble.ts:122-134`) and discards them
  after rendering.
- **Done when:** a focus entry whose line falls outside every hunk range of its
  file is either dropped or has its line cleared — decide which and say why in
  the code — the `hooks/brief.ts` comment matches what the code now does, and a
  test plants an out-of-range line and asserts the outcome.

## F5 — Duplicate React key on `file_refs`
- **Source:** R3 correctness, finding 6
- **Severity:** minor — included only because it is one line inside a file F2
  already opens, and it is a real reconciliation bug rather than a style point
- **Evidence:** `WhyRiskCard.tsx:220-222` uses `key={ref}` while nothing dedupes
  `file_refs` (`vendor/shared/contracts/brief.ts:82` is `z.array(z.string())`,
  and `grounding.ts:136` only filters). The two sibling lists in the same file
  both append `:${i}`; this one does not.
- **Done when:** the key is unique for a duplicated `file_refs` entry, matching
  the sibling lists.

---

## Verification for the round
- `cd server && pnpm typecheck` and `cd client && pnpm typecheck`
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' --reporter=dot`
- `cd server && DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock pnpm exec vitest run .it.test --reporter=dot`
- `cd client && pnpm test -- --reporter=dot`

Nothing that was green may turn red. There is no linter in this repo.

**A finding you believe is wrong:** push back with evidence rather than fixing it
quietly. That moves it to `contested` and the user decides — it does not get
patched around.
