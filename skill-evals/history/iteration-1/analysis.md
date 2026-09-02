# Iteration 1 — analyst pass

Model: Opus 5 (1M) for both arms. 3 cases × 2 arms = 6 runs, one run per cell.

## The assertions did not discriminate

**15/15 for both arms.** All nine planted issues were found by both arms in all three cases,
and neither arm reported a single decoy. Pass rate delta: **+0.00**.

That is a real result about this skill on this model, not a broken harness: an Opus-class
baseline already knows `jwt.decode` ≠ `jwt.verify`, `Post.create(req.body)`, `exec()` with a
query param, `dangerouslySetInnerHTML`, and `origin: true` + `credentials: true`. A skill that
restates OWASP Top 10 cannot add recall it does not have room to add.

## Where the arms actually differ: volume

| | eval-0 auth | eval-1 posts | eval-2 frontend | total |
|---|---|---|---|---|
| with_skill findings | 8 | 6 | 3 | **17** |
| without_skill findings | 15 | 13 | 9 | **37** |
| planted issues found | 3 / 3 | 3 / 3 | 3 / 3 | 9 / 9 (both arms) |
| non-planted items, with_skill | 5 | 3 | 0 | 8 |
| non-planted items, without_skill | 12 | 10 | 6 | 28 |

**Signal density (planted ÷ reported): 53% with the skill, 24% without it.**

Case 2 is the cleanest illustration: with the skill the review is exactly the three planted
issues and nothing else, and everything below the bar is moved into an explicit
"Verified-safe (checked, deliberately not reported)" section. Without the skill the same three
sit at the top of a nine-item list that also carries CSRF, CSP, rate limiting, `trust proxy`,
morgan logging, and a missing error boundary.

The mechanism is in the skill text: the confidence table (`HIGH` → report, `MEDIUM` → note,
`LOW` → do not report) and the explicit "Do NOT flag" list. Both arms *credit* the correct
controls; only the skill arm withholds the low-confidence items from the findings list.

## Severity calibration

Three of the nine planted issues were rated differently by the two arms:

| Planted issue | with_skill | without_skill | Skill's severity table says |
|---|---|---|---|
| Hardcoded JWT secret fallback | CRITICAL | High | CRITICAL — "hardcoded prod secrets" |
| IDOR on delete | HIGH | Critical | HIGH — "IDOR on delete" |
| Stored XSS via post body | HIGH | Critical | HIGH — "Stored XSS in blog content" |

The skill arm matches the skill's own severity table in all three cases. This is consistency,
not correctness — the value is that two reviews of two different PRs come back on the same
scale.

## Cost

| | with_skill | without_skill |
|---|---|---|
| subagent tokens (mean) | 53,846 | 39,773 |
| wall clock (mean) | 140.5 s | 148.9 s |
| review length, chars (mean) | 14,941 | 18,505 |

**+35% tokens for a 19% shorter review.** The extra spend goes into reading SKILL.md plus its
bundled files, and into the data-flow tracing the skill mandates before a finding may be
reported. Wall clock is a wash.

## What the baseline caught that the skill arm missed

`case-2-posts/src/middleware/auth.js` requires `jsonwebtoken`, but `package.json` declares only
`express` and `mongoose`. The baseline reported it (M1, A03 supply chain); the skill arm did
not, despite A03 being in the skill's own table. One data point, but it is the only
recall difference in the whole run — and it is a *dependency-manifest* check, the kind of thing
the skill's "detect context → load relevant rules" step can steer attention away from.

## Eval critique — what iteration 2 should change

1. **The plants are too easy.** Every one is a textbook pattern a strong model recognises on
   sight. Replace at least one per case with something that needs the data flow actually
   traced: a sink that is safe in one caller and unsafe in another, or an input that becomes
   attacker-controlled two hops upstream.
2. **The decoys are too easy too.** Zero false positives in six runs. Stronger decoys: a
   `dangerouslySetInnerHTML` that *is* already DOMPurify-sanitized; an `exec()` whose argument
   comes from a config constant; a `findOne` on `req.params.id` (always a string in Express, so
   not injectable).
3. **Add a noise assertion.** The one axis that separated the arms is not measured by any
   assertion. Add: "reports no more than N findings" or "every reported finding is HIGH
   confidence per the skill's own table". Without it the benchmark reads +0.00 and hides the
   real difference.
4. **One run per cell.** No variance estimate. Three runs per cell would show whether the
   17-vs-37 gap is stable.
