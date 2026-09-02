# Insights — e2e

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

- **2026-08-28** — On a dev machine with a real GitHub PAT configured (`~/.devdigest/secrets.json`, path from `server/src/platform/config.ts:101`), `./scripts/e2e.sh` can go flaky specifically on the shared "open the PR row" step (`find text "..." click`, present verbatim in flows `02`, `04`, `05`, `09` — `grep -l "open the PR row" e2e/specs/*.flow.json`), because opening a PR's detail route (`GET /pulls/:id`) refreshes from GitHub (`container.github()`, `server/src/modules/pulls/routes.ts:260` and other sites) and `find` does not retry/poll the way `wait` does — `agent-browser skills get core --full` documents explicit condition-polling for `wait --text`/`--url`/`--load`/`--fn` but no such behaviour for `find`. CI has no PAT configured, so this does not surface there. Reported as reproduced against the unmodified pre-T7 tree — i.e. environmental, not content-specific.

## Codebase Patterns

## Tool & Library Notes

- **2026-08-28** — `agent-browser`'s `wait --text` matches the page's RENDERED text, so a component styled with CSS `text-transform: uppercase` needs the flow's `--text` value written in the transformed case, not the i18n source string. `specs/09-pr-brief.flow.json` does this deliberately and says so in its own step labels: `wait --text "WHY & RISK"` for `SectionLabel` ("CSS text-transform: uppercase") and `wait --text "RISK LEVEL"` for `WhyRiskCard`'s risk-level label ("also CSS-uppercased") — while the very next assertion waits for `"High"` (not `"HIGH"`) because the `Badge` rendering the level itself is NOT uppercase-transformed. Same page, two different casing rules depending on which element renders the string. Evidence: `e2e/specs/09-pr-brief.flow.json`, `client/src/vendor/ui/primitives/SectionLabel.tsx:22`, `client/src/app/repos/[repoId]/pulls/[number]/_components/WhyRiskCard/styles.ts:21-27`.

## Recurring Errors & Fixes

## Session Notes

## Open Questions
