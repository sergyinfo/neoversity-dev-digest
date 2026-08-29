import { RetroLedgerView } from "./_components/RetroLedgerView";

/* Route: /retro — a read-only viewer for the committed `docs/retro/ledger.md`.
   Thin route entry, following `app/conventions/page.tsx`: the view, its empty
   states and styles are colocated under _components.

   This page never RUNS a retro. `/retro` is a Claude Code slash command a human
   types; there is no write path here and no mutation hook behind it. */
export default function RetroPage() {
  return <RetroLedgerView />;
}
