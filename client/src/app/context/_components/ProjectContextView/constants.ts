/** The Project Context page's two tabs (D-1 — per-target attachment: Agents
 * and Skills, not a shared attach list). */
export type ContextTabKey = "agents" | "skills";

/**
 * The clone's last-synced time, for the Freshness note (§6/D-7): this page
 * has no refresh affordance of its own and defers to the repo-level resync.
 * `null` reads as never-synced. Matches the untranslated "synced"/"not
 * synced" precedent at `components/app-shell/helpers.ts:12` — there is no
 * i18n key for this in `context.json`, and that file sits outside this
 * track's file set to extend.
 */
export function formatLastSynced(iso: string | null): string {
  if (!iso) return "Never synced";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never synced" : `Last synced ${d.toLocaleString()}`;
}
