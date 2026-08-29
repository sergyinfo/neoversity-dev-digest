"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

/**
 * hooks/retro.ts — the retro ledger viewer.
 *   GET /retro/ledger → the committed `docs/retro/ledger.md` + its mtime
 *
 * READ-ONLY, and there is no companion mutation on purpose: `/retro` is a
 * Claude Code slash command a human types. Nothing in this app runs a retro or
 * writes the ledger, so there is no `POST` to wrap.
 *
 * The envelope below is declared LOCALLY, not in `@devdigest/shared`, following
 * `hooks/blast.ts` and `hooks/project-context.ts`: no route in the server
 * declares a Zod `response:` schema, so a shared contract for a response would
 * buy types only, at the cost of entering the do-not-touch zone and widening
 * the two-vendored-copies byte-identity surface. The authoritative shape lives
 * at `server/src/modules/retro/contract.ts`; these field names are kept in step
 * with it by hand, the same relationship the two hooks above already have.
 */
export interface RetroLedger {
  /** The ledger's markdown, verbatim. Empty string when the file is absent. */
  content: string;
  /**
   * The file's mtime, ISO. A filesystem timestamp, not a "the retro ran at" —
   * a fresh `git checkout` moves it, so present it as "file last changed",
   * never as the date of the newest entry.
   */
  updated_at: string | null;
  /**
   * Whether the file exists. Distinguishes "nobody has run `/retro` yet" from
   * "the ledger is there and has no entries" — two different empty states that
   * must not share copy.
   */
  exists: boolean;
  /** Where the ledger lives, repo-relative. A server constant, never an input. */
  path: string;
}

export function useRetroLedger() {
  return useQuery({
    queryKey: ["retro", "ledger"],
    queryFn: () => api.get<RetroLedger>("/retro/ledger"),
  });
}
