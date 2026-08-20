import type { SmartDiffRole } from "@devdigest/shared";

/**
 * Presentation rules for the reviewer-ordered diff. Thresholds and per-role
 * behaviour live here rather than inside the component, so changing "should
 * boilerplate start open?" is a one-line edit in one place.
 */

/** Group order and copy. The array order IS the render order. */
export const ROLE_META: readonly {
  role: SmartDiffRole;
  label: string;
  hint: string;
  color: string;
}[] = [
  {
    role: "core",
    label: "Core logic",
    hint: "The substance of the change — review closely",
    color: "var(--accent, #4493f8)",
  },
  {
    role: "wiring",
    label: "Wiring",
    hint: "Hooks the core into the app",
    color: "var(--sev-warning, #d29922)",
  },
  {
    role: "boilerplate",
    label: "Boilerplate",
    hint: "Generated / mechanical — skim",
    color: "var(--text-muted, #8b949e)",
  },
];

/**
 * Which roles start expanded when a file carries no findings.
 *
 * Boilerplate is absent on purpose and that is an acceptance criterion: a lock
 * file must start collapsed no matter how few lines it changed. A file WITH a
 * finding overrides this — see `defaultOpenFor`.
 */
export const EXPANDED_BY_DEFAULT: readonly SmartDiffRole[] = ["core"];

/**
 * Should this file start open?
 *
 * A finding always wins: if the last review flagged something, the reviewer
 * should see it without a click, even in boilerplate — a secret committed to a
 * generated file is still a committed secret.
 */
export function defaultOpenFor(role: SmartDiffRole, findingCount: number): boolean {
  if (findingCount > 0) return true;
  return EXPANDED_BY_DEFAULT.includes(role);
}
