# L02 demo video — shooting script

Two acceptance criteria to satisfy on camera:

1. **Conventions Extractor** — from running the scan to a skill linked to an agent.
2. **API Contract Reviewer** — the same PR reviewed without skills, then with them.

Target length **6–8 minutes**. Everything below is verified working as of 2026-08-03.

---

## 0. Pre-flight (do NOT record this)

### 0.1 Stack up

```sh
./scripts/dev.sh
```

Wait for `:3000` and `:3001`. Confirm the repo switcher shows a repo.

### 0.2 Be on the right branch

```sh
git checkout lesson-3/intent-smart-diff
```

**This matters.** The experiment branch contains the deliberately broken contract.
If the working tree is on it, `tsx watch` reloads the server with a `Finding`
schema whose field names no longer match the database, and every review fails
with `null value in column "rationale"`. The diff under review must be **data**,
never the code the server is running.

### 0.3 Reset the demo state

Current state has everything already done, so nothing would happen on camera.
One script does the whole reset — it discovers every id itself:

```sh
bash scripts/demo-reset.sh
```

It refuses to run if you are on the experiment branch, then:

1. deletes the `*-conventions` skill (otherwise "Create skill" hits a name collision),
2. unlinks all skills from **API Contract Reviewer** — run A needs a clean control,
3. **enables** that agent, so the Run Review menu does not show `· disabled` next to it,
4. deletes every previous run on PR #3 so the Agent-runs tab starts empty,
5. prints the final state — linked skills and runs must both read **0**.

Conventions themselves are **not** cleared, and don't need to be: the scan is a
delete-then-insert (`conventions/repository.ts:106`), so it replaces them wholesale.
Running the scan on camera is the point.

You do not need to note any ids down — the relink in §6 happens in the UI.

### 0.35 Click through every screen once, before rolling

Two failure modes that look identical to a bug and are not:

- **First hit on a route takes >120 s.** Next.js compiles routes on demand in dev;
  the same page answers in ~0.2 s afterwards. Visit `/conventions`, `/skills`,
  `/agents`, and the Agents **Skills** tab once to warm them, or you will record
  a two-minute white screen and think something broke.
- **A browser extension that intercepts `fetch` can leave every page on skeletons**
  while the API is perfectly healthy — zero requests reach `:3001` and the only
  console error comes from the extension itself. Record in a clean profile with
  no automation extension loaded. This cost me an hour.

The Agents → **Skills** tab is the newest screen and the one I never confirmed
visually for exactly that reason. Open it and link/unlink one skill before you
record, so the first time you see it working is not on camera.

### 0.4 Screen setup

- Browser at ~1400×900, zoom 110–125 %.
- Close other tabs; hide the bookmarks bar.
- Have two tabs ready: DevDigest, and PR #3 on GitHub.

### 0.5 Know the dead air

| Step | Wait |
|---|---|
| Conventions scan | ~30–60 s |
| Each review run | ~60–120 s |

Three waits, up to five minutes of nothing. **Cut them in the edit** or talk over
them — do not leave them in.

---

## 1. Conventions Extractor — the scan (~60 s)

1. Repo switcher → **sergyinfo/lca-normalization-engine**. Point out `develop · synced` — a real, cloned, indexed repo, not a fixture.
2. Sidebar → **SKILLS LAB → Conventions**.
3. Read the subtitle aloud — it is the whole architecture in one line: *configs and the most-depended-on files are sampled in code, one cheap model call proposes rules, every candidate is checked against the real file.*
4. Click **Scan**.

> "Only one of the four stages calls a model. Sampling and verification are plain
> code — which is what keeps this cheap and what makes the evidence trustworthy."

5. When it lands, read the counts line:

> **`Last scan proposed 12, kept 5 · merged 7 duplicate(s).`**

**Do not memorise those three numbers** — read whatever is on screen. Extraction
runs at temperature 0, but the sampler picks files by dependency rank and the
scan re-runs from scratch each time, so the counts move between scans. The later
scan sitting in the database right now kept 8. The *shape* of the sentence is the
point, not the digits.

Say why 7 were merged: the model restates one rule once per file it saw it in.
The extra sites are kept as supporting evidence, not thrown away — visible as the
`(also seen in …)` tail on each rule.

---

## 2. Evidence is real — the clickable proof (~45 s)

This is an explicit acceptance criterion, so make it unmissable.

1. Pick the **small-cell suppression** card (`sponsor-facet.ts`). **It may not be in
   this scan** — the sample changes. Any card works: the beat is "click the
   citation, land on those exact lines, the code matches". Pick whichever card has
   the clearest snippet and adapt the sentence below.
2. Click the `apps/analytics-web/lib/sponsor-facet.ts:14-21` link — GitHub opens at those exact lines.
3. Show the snippet on GitHub matches the card.

> "A candidate is only kept if its snippet actually appears at the cited lines.
> File-and-line existence is easy to guess; matching the code is what proves the
> model read it."

**Worth saying:** this particular rule — the 25-filing suppression floor — is the
convention behind a P1 that a human reviewer caught in that repo's PR #121 and
that the general review agents missed.

4. Back in DevDigest, **Reject** one card, then **Accept** the rest. Rejecting one on camera is what proves the next step filters.

---

## 3. Accepted → skill (~60 s)

1. Note the counter: **`N-1 of N accepted`** (whatever the scan produced, minus the
   one you just rejected).
2. Click **Create skill**.
3. In the modal, point out **"Merged from 4 accepted convention(s)"** — one fewer than the list.

> "The server re-reads the accepted rows from the database. The client sends no
> id list, so a rejected candidate cannot reach a skill even if the UI asked it to."

4. Scroll the body. Show it reads as instructions — *"Flag changes that violate any rule below and cite the offending file:line"* — not as a description of the repo.
5. Edit something small (tighten a rule) to show the draft is editable.
6. **Create skill** → lands on `/skills/:id`.
7. On the editor: **Config** tab, then **Preview** tab (rendered markdown = what the agent receives). Point at `convention · extracted · v1` — the provenance says where it came from.

---

## 4. Link the skill to an agent (~20 s)

1. **Agents** → open any reviewer → **Skills** tab.
2. Link `lca-normalization-engine-conventions`.

> "Linked skills are appended to that agent's prompt at run time. That was the
> missing wire — the link API existed, but the server never sent the bodies."

Optional if time is tight; the same mechanism is shown properly in §6.

---

## 5. API Contract Reviewer — setup (~45 s)

1. **Agents** → **API Contract Reviewer**. Show the system prompt briefly — narrow by design: contract damage only.
2. **Skills** tab — **empty right now**. Say so explicitly; it is run A's control condition.
3. Switch to the GitHub tab, show **PR #3**: six lines, two files.

Read the three changes:

| Change | Subtlety |
|---|---|
| `rationale` → `explanation` | obvious |
| `suggestion` optional → required | moderate |
| `confidence` → `.nullable()` | **the subtle one** |

> "The third reads like a relaxation. On the way *out* it is the opposite: the
> caller was promised a number and now must handle null."

---

## 6. The A/B (~2 min plus waits)

**Run A — no skills.** Repo switcher → `sergyinfo/neoversity-dev-digest` → PR #3 →
**Run Review ▾** → API Contract Reviewer.

Result to expect:

```
2 findings · score 30
  CRITICAL  rationale → explanation
  CRITICAL  suggestion optional → required
```

Say what is missing: **`confidence` → nullable was not flagged.**

**Link the skills.** Agents → API Contract Reviewer → Skills → add all four.
Point out `semver-discipline` shows **imported** — it was created by URL import,
not typed in.

**Run B — same PR, same agent.**

```
3 findings · score 0
  CRITICAL  rationale renamed, no deprecation
  CRITICAL  confidence non-nullable → nullable     ← the one A missed
  CRITICAL  suggestion optional → required
```

**Numbers will not match this page exactly.** Reviews run at the agent's default
temperature, so the *composition* of findings shifts between runs. Across three
recorded runs the two CRITICALs above were present every time; the `suggestion`
one appeared twice and on the third run was explicitly dismissed as safe. Read
what is on screen, not what is written here.

**Close on the trace.** Open run B's **Run trace** → `prompt_assembly.skills`
≈ 7 800 characters, all four skills present. Run A's is empty.

### 6.1 The semver beat — a skill that correctly says nothing

PR #3 also carries a `server/package.json` patch bump (`0.0.0` → `0.0.1`) next to
two breaking changes. That is textbook semver abuse, so `semver-discipline` looks
like it should fire. It doesn't — and it says why in the summary:

> *"The version bump is not flagged because the package is private."*

`server/package.json` has `"private": true`, and the skill's own exclusion list
says: *"Internal-only packages marked `private: true` that nothing outside the
repo consumes."* The skill read the diff, applied its exclusion, and abstained.

This is worth 20 seconds on camera. A skill that fires on everything is a skill
that has learned nothing; the exclusions are as much a part of it as the rules.

If you would rather see it fire, delete `"private": true` in the worktree, push,
re-open the PR in DevDigest, and re-run. Trading a true negative for a positive
is a downgrade, though — recommend keeping it.

> "Same diff, same agent, same model. The only difference is what was in the
> prompt — and the trace shows exactly that."

Also worth pointing at: B separates **response** fields from the **request**
field. That distinction exists only in the skills.

---

## 7. Close (~20 s)

- Extractor: sampling and verification are code; one cheap model call; dedupe took 12 candidates down to 5 real rules.
- Skills: extracted from evidence, human-reviewed, linked to an agent, and demonstrably changing what the agent finds.

---

## Honesty notes for the voiceover

Say these. They are the strongest part of the submission, not a weakness.

- **`dropped` is shown even when it is 0.** A run that proposed 8 and kept 2 tells you something a list of 2 cards does not.
- **The first A/B run gave the opposite result** — 3 findings without skills, 1 with. Cause: the PR description said "deliberately breaking, not for merge", and the skilled run quoted it instead of analysing. Removing that line reversed the outcome. Worth saying out loud: an experiment that confirms your hypothesis on the first try deserves suspicion.
- **One model, one repo, one diff.** This is a demonstration, not a benchmark.
- **Runs are not reproducible.** The set of findings shifted between the three runs I recorded. If a live run lands differently from what you just narrated, say so — that is the honest reading of a non-deterministic system, and re-rolling until it looks good is the thing this whole exercise argues against.
- **One skill deliberately stayed silent** (§6.1). Do not present it as a miss.

## Do not do on camera

- Do not switch git branches while the stack is running (§0.2).
- Do not merge PR #3. It is deliberately broken; close it after recording.
- Do not run `Run Review ▾ → all agents` — it would fan out to every enabled agent and cost real money. Note the reset script **enables** API Contract Reviewer, so "all" is now four agents, not three.

## After recording

```sh
gh pr close 3                                    # deliberately broken, never merge
git worktree list                                # remove the experiment worktree
git worktree remove <path>
```
