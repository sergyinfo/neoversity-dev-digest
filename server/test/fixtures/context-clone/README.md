# acme/payments-api (fixture)

This is the seeded `context-clone` fixture used by `project-context` tests
and e2e flow `08`. This file is a **committable negative** (S18): a root
`README.md` has no directory segment at all, so it matches neither
`CONTEXT_DOC_DIR_SEGMENTS` nor the `.devdigest/specs/` prefix, and must never
appear in a `GET /repos/:id/context` listing.
