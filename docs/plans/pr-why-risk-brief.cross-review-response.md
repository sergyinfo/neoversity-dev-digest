Here is the independent review of the implementation plan against the specification and repository constraints.

---

### Findings

#### 1. Step "Done when" / Spec Discrepancy: Read-path fingerprint check fails to detect edits to referenced documents or linked issues (REQ-14, AC-20, Section 6 vs. S7, S11)

- **Requirement / Section IDs:** REQ-14, REQ-8, AC-20, Section 6 (*Freshness* row), S7, S11.
- **Category:** (c) Steps whose "Done when" could pass while the requirement still fails.
- **Details:**
  - REQ-14 mandates: *"WHILE a stored brief's state fingerprint differs from the fingerprint of the current inputs, THE SYSTEM SHALL render that brief marked as out of date and name which input moved."*
  - Section 6 (*Freshness*) and AC-20 explicitly state that editing a referenced repository document or linked issue (with no new commit) must cause the brief to read as out of date.
  - S7 splits the fingerprint into `local` and `remote` digests, placing referenced documents and the linked issue into `remote`. S11's read path (`GET /pulls/:id/brief`) explicitly recomputes **only** the `local` fingerprint components to stay DB-only.
  - Consequently, if a referenced specification file in the repository clone or a linked issue on GitHub is edited without moving the PR head, `GET /pulls/:id/brief` will recompute only `local` components, observe a match, and serve the brief as current (`out_of_date: false`).
  - Thus, S11's read path will report the brief as up-to-date in cases where REQ-14, AC-20, and Section 6 require it to be marked out of date.

---

### Coverage & Soundness Assessment

- **(a) Uncovered Requirements:** None. All 15 requirements (REQ-1 through REQ-15) and 34 acceptance criteria (AC-1 through AC-34) are mapped to implementation steps.
- **(b) Unnecessary Steps:** None. Every step (S1 through S20) satisfies identified requirements, database migrations, contracts, test fixtures, or e2e flows.
- **(d) Dependency & Ordering Errors:** None. Track dependencies (T0 through T8) are acyclic and preserve necessary ordering:
  - T0 establishes the schema and database migration barrier before dependent server/client steps start.
  - T1 extends the resolver before T2 builds assembly and grounding on top of it.
  - T2 pure modules complete before T3 service/route wiring.
  - T4 client hooks/i18n land before T5 card UI and T6 diff-viewer focus integration.
  - T7 seeds and e2e flow run only after server, client, and diff-viewer changes have landed.
- **(e) Unnamed Risks:** None. The plan accurately identifies package isolation rules, tenancy scoping traps on `pr_brief`, tokenizer fallback mechanics, rate limiter store behavior, and Docker testcontainer setup requirements.