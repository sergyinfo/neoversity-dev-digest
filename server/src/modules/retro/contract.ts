/**
 * The `GET /retro/ledger` HTTP envelope.
 *
 * MODULE-LOCAL ON PURPOSE, for the reasons already recorded for the blast
 * envelope (`modules/blast/contract.ts`, 2026-08-23): no route in this server
 * declares a Zod `response:` schema, so a shared contract for a *response*
 * would buy types only, at the cost of entering the `vendor/shared`
 * do-not-touch zone and widening the two-vendored-copies byte-identity
 * surface. Nothing here is workspace data either, so it has no business in a
 * shared domain contract.
 *
 * This schema is the named source of truth for the envelope; the route test
 * parses a live response against it, which is what keeps the client copy
 * (`client/src/lib/hooks/retro.ts`) honest.
 */
import { z } from 'zod';

export const RetroLedger = z.object({
  /**
   * The ledger's markdown, verbatim. Empty string when the file is absent —
   * see `exists`, which is what distinguishes "not written yet" from "written
   * and empty". Never null, so a renderer needs no null branch.
   */
  content: z.string(),
  /**
   * The file's mtime as an ISO string, or null when there is no file. This is
   * a filesystem timestamp, not a recorded "retro ran at" — a `git checkout`
   * moves it.
   */
  updated_at: z.string().nullable(),
  /** Whether the file was found on disk. Absence is a normal state, not an error. */
  exists: z.boolean(),
  /**
   * Where the ledger lives, relative to the repo root. A constant echoed back
   * so the UI can name the file in its empty state without hard-coding a
   * second copy of the path. NOT an input — see `ledger.ts`.
   */
  path: z.string(),
});
export type RetroLedger = z.infer<typeof RetroLedger>;
