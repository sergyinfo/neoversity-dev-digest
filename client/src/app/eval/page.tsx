import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval — the Eval Dashboard (L06), under Skills Lab. Thin route entry,
   following `app/retro/page.tsx`: the view and its states live under
   _components. */
export default function EvalPage() {
  return <EvalDashboardView />;
}
