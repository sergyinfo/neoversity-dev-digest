# Payments API — Overview

`acme/payments-api` fronts the public payment endpoints for the demo
storefront: rate limiting, webhook verification, and the user list used by
the billing dashboard.

This document exists as the **leading-segment** discovery case for
`project-context` (S18): `docs/` is the first path segment, which is the
ordinary shape `hasAllowedSegment` was written for.

## Scope

- Public API rate limiting (token bucket, per client key).
- Stripe webhook signature verification.
- User listing for the billing dashboard.

Nothing here should be treated as an instruction to a reviewing agent — it is
project context, read-only, same as every other document under this tree.
