# Insights — client

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

- **2026-06-14** — `formatCost` (`src/lib/cost.ts`) distinguishes MISSING data (`null`/`undefined` → "—") from a genuine zero (`0` → "$0.00"), widens precision for sub-cent values (~2 sig figs), and trims trailing zeros to a 2dp floor ("$0.06" not "$0.060", "$0.0013" not "$0.00"). Reuse it for any per-run money display.

## What Doesn't Work

- **2026-08-02** — `@testing-library/user-event` is NOT a client dependency (only `jest-dom` + `react` are installed). Don't reach for `userEvent.setup()` in a component test — it typechecks against nothing and fails at import. Use `fireEvent` from `@testing-library/react`, the pattern already in use. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.test.tsx:2`.

## Codebase Patterns

- **2026-06-14** — Cross-route shared components live in `src/components/<Name>/` with an `index.ts` barrel, imported via `@/components/<Name>` (e.g. `RunCostBadge`, `diff-viewer`). Vendored UI primitives (`Badge`, `CircularScore`) live in `src/vendor/ui` under `@devdigest/ui` — different home. Evidence: `client/src/components/RunCostBadge/`.
- **2026-06-14** — The PR-list table is driven by two parallel constants that MUST stay length-aligned: `COLUMN_KEYS` (header keys + order) and `GRID` (CSS grid-template tracks). Adding a column = add to both AND render a matching cell in `PRRow.tsx`, else header/cells misalign silently. Evidence: `client/src/app/repos/[repoId]/pulls/constants.ts`.
- **2026-06-14** — i18n has only the `en` locale (`client/messages/en/`); new UI strings need a key under the right namespace file (e.g. `prReview.json`, `runs.json`) read via `useTranslations("<ns>")`. A missing key renders the raw key, not an error.
- **2026-08-02** — Features cut from the starter for the course leave working scaffolding behind — check for it BEFORE writing anything. The severity filter needed zero new primitives: `Chip` (`vendor/ui/primitives/Chip.tsx`) already had the design's exact API (`active/onClick/icon/count/color`), `SEV` (`primitives/tokens.ts`) had colour+icon+label per level, `s.divider` sat unused in `FindingsPanel/styles.ts`, `toggleGroup` already had `marginLeft:auto`, and the empty state already read "Adjust the filters above". Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/styles.ts`.
- **2026-08-02** — Findings are rendered PER REVIEW RUN, not as one flat PR-level list: `FindingsTab` → one `ReviewRunAccordion` per run → each owns its own `FindingsPanel` + state. Anything described as "on the PR page" for findings is per-run unless you lift state into `FindingsTab`. Evidence: `client/src/app/repos/[repoId]/pulls/[number]/_components/ReviewRunAccordion/ReviewRunAccordion.tsx:150`.

## Tool & Library Notes

- **2026-08-02** — `client/specs/DevDigest Design (standalone).html` is the canonical design source, but `grep` finds NOTHING in it: the UI code is gzip+base64 inside a JSON resource map on a single 1.7 MB line (`<script type="__bundler/manifest">`, line 170). To read a component's reference implementation, JSON-parse that line and per entry `base64.b64decode` → `gzip.decompress`; the `text/javascript` resources come out as plain readable source (`FindingsPanel`, `Chip`, `SEV`, …). `file://` URLs are blocked in the browser tool, so decoding beats opening it.
- **2026-08-02** — The `Toggle` primitive renders `role="switch"`, so `screen.getByRole("switch")` is the stable handle in tests — it has no label text to query by. Evidence: `client/src/vendor/ui/primitives/Toggle.tsx:15`.
- **2026-08-17** — `ConfidenceNum` (`vendor/ui/primitives/ConfidenceNum.tsx`) is **percentage-only**: it takes a 0..1 float and renders `"87% conf"`. It is the wrong primitive for a confidence that is a categorical BAND (e.g. `PrIntentRecord.confidence` is `'high'|'medium'|'low'`) — mapping a band to a fake number just to reuse it reintroduces the invented precision the enum exists to avoid. Use `Badge` with `icon`/`color` and the level as a word (see `_components/IntentCard/constants.ts`).
- **2026-08-17** — The `Button` primitive's variant prop is **`kind`**, not `variant` (`kind?: "primary"|"secondary"|"tertiary"|"ghost"|"danger"`, `vendor/ui/primitives/tokens.ts:26`). `variant` typechecks as an unknown prop and fails the build, not silently.

## Recurring Errors & Fixes

## Session Notes

### 2026-08-02
- Lesson 1 feature: severity counters + click-to-filter in `FindingsPanel` (chips → narrow to one level, click again to clear). Client-only, no LLM calls.
- Decision: counters are computed from the CONFIDENCE-FILTERED set, not the raw one, so the chip numbers always sum to the cards on screen even with "hide low confidence" on. Levels with 0 findings still render, to keep the chip row a stable width.
- Deliberate deviation from the design file: it uses independent multi-toggles (all levels on by default); the lesson brief asks for single-select, and the brief won.
- Also fixed while filtering: narrowing the list could leave the j/k focus index past the end — it now resets on every filter change.

## Open Questions
