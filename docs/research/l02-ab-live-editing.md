# The A/B, and how to edit live on camera

Companion to `l02-demo-video-script.md`. Read this before recording if you want
to change anything mid-session.

---

## 1. What the A/B actually measured

Same PR, same agent, same model, same PR description. The only variable was
whether four skills were linked.

| | A — no skills | B — skills linked |
|---|---|---|
| Findings | 2 | **3** |
| Score | 30 | 0 |
| `rationale` → `explanation` | ✓ | ✓ |
| `suggestion` optional → required | ✓ | ✓ |
| **`confidence` → `.nullable()`** | **missed** | **✓** |

`prompt_assembly.skills` in the trace: **empty** in A, **≈7 800 characters** in B.

### Why that third one is the whole experiment

The first two are visible to anyone. A renamed field is obviously breaking, and
"optional → required" reads as a tightening.

`confidence: z.number()` → `z.number().nullable()` reads as a *relaxation*, so it
slips through. On a **response** it is the opposite of a relaxation: the caller
was promised a number and now must handle `null`. The `response-schema` skill
contains exactly that paragraph, under the heading *"The direction that gets
missed"*.

B also separated **response** fields (`rationale`, `confidence`) from the
**request** field (`suggestion`). That distinction exists nowhere except in the
skills.

### What this is not

One diff, one model, one repo, two runs. A demonstration that the wiring works
and that the content changes the outcome — not a benchmark. Say so.

---

## 2. The trap: the working tree IS the running server

The thing I got wrong first time.

`./scripts/dev.sh` runs the API under `tsx watch`. **Any file you edit in the
checked-out tree reloads the server.** When I checked out the experiment branch,
the server reloaded with a `Finding` schema whose fields no longer matched the
database, and every review died with:

```
Run failed: null value in column "rationale" of relation "findings"
             violates not-null constraint
```

**The diff under review must be data, never the code the server is running.**

### Where the reviewed diff actually comes from

Not your working tree. The chain is:

```
GitHub PR  →  GET /pulls/:id  →  pr_files table  →  review
```

`modules/pulls/routes.ts:223` **deletes and re-inserts** `pr_files` on every
`GET /pulls/:id`. So opening the PR page in DevDigest re-pulls the diff from
GitHub.

Consequence: **editing a local file changes nothing about what the agent sees.**
To change the reviewed diff you must commit, push, and re-open the PR in
DevDigest.

---

## 3. Three ways to change things live, easiest first

### Option 1 — toggle a skill off (no code at all) ★ cheapest

Skills → open `response-schema` → **Enabled** off → Save → re-run the review.

Disabled skills are filtered **in SQL** (`skill.repo.ts`), so the body never
reaches the prompt. Expect the `confidence` finding to disappear.

One toggle, one re-run, no git, no risk. If you only do one live change, do this.

### Option 2 — edit a skill body live ★ most convincing

Skills → `response-schema` → **Config** → delete the *"The direction that gets
missed"* paragraph → Save (the version bumps to v2 — only a body change bumps
it) → re-run.

This isolates the experiment down to **one paragraph**. Removing it should lose
the `confidence` finding; pasting it back should recover it. Nothing else in the
system changes.

Two caveats worth knowing:
- **Model runs are not deterministic.** Temperature is 0 for conventions but reviews run at the agent's default, so a single re-run can differ by chance. If the result does not flip, say so on camera rather than re-rolling silently until it does.
- Keep the removed paragraph in your clipboard so you can restore it in one paste.

### Option 3 — change the reviewed diff live (needs a worktree)

If you want to edit the *contract* on camera, do **not** edit the checked-out
tree. Use a second worktree so the running server never sees it:

```sh
# once, before recording
git worktree add ../devdigest-exp experiment/api-contract-change
```

Then on camera, in that directory:

```sh
cd ../devdigest-exp
# edit server/src/vendor/shared/contracts/findings.ts
git commit -am "another contract tweak"
git push
```

Back in DevDigest: open PR #3 (this re-fetches `pr_files` from GitHub) → re-run.

Verify before recording that the main checkout is untouched:

```sh
cd <main checkout> && git status --short   # must be clean
```

Cleanup afterwards: `git worktree remove ../devdigest-exp`.

**Good live edits for this option**

| Edit | Should be caught by | Expected |
|---|---|---|
| Delete an exported function used elsewhere | `deprecation-policy` | CRITICAL — removed with no prior deprecation |
| Add `@deprecated` with no replacement or version | `deprecation-policy` | WARNING — announced but incomplete |
| Remove an enum member from a response union | `breaking-change` | CRITICAL |
| Bump `server/package.json` patch alongside the break | `semver-discipline` | CRITICAL — requires major |

The last one is the nicest unused beat: nothing in the current PR touches a
version, so `semver-discipline` has had nothing to say yet. Adding a patch bump
to a breaking PR gives that skill its moment.

---

## 4. Timing and cost, so nothing surprises you

| Action | Wall clock | Cost |
|---|---|---|
| Conventions scan | 30–60 s | ~$0.01 |
| One review run | 60–120 s | ~$0.02 |
| Full A/B (two runs) | 2–4 min | ~$0.04 |

Cheap enough to re-run a few times. The real budget is **screen time** — plan to
cut the waits.

**Never press `Run Review ▾ → all agents`.** It fans out to every enabled agent;
right now that is three, on top of the one you want.

---

## 5. Pre-flight for a live-editing session

```sh
git checkout lesson-3/intent-smart-diff      # NOT the experiment branch
git status --short                            # clean
./scripts/dev.sh
```

Then confirm in the browser you will actually record in — not one with an
automation extension loaded — that `/agents`, `/skills` and `/conventions` all
render data. An extension that intercepts fetch can leave every page stuck on
skeletons while the API is perfectly healthy; that cost me an hour.

Reset before rolling: unlink the four skills, delete the conventions skill,
delete previous runs on PR #3. Details in the shooting script.

---

## 6. If a live run gives the "wrong" result

It can. Two runs is a small sample and the model is not deterministic.

Say what happened and why it is still informative — a negative result you report
is worth more than a positive one you re-rolled until it appeared. My own first
A/B came out **backwards** (3 findings without skills, 1 with) because the PR
description said "deliberately breaking, not for merge" and the skilled run
quoted it instead of analysing. Removing that line reversed the outcome.

That story is worth telling on camera regardless of how the live run lands.
