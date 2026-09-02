/**
 * CI change detector for the harness evals.
 *
 * Reads a newline-separated list of changed files (repo-relative) from $CHANGED_FILES and maps
 * them onto the eval suites that should run for this PR:
 *
 *   .claude/skills/<name>/**   OR  evals/skills/<name>/**   → run evals/skills/<name>  (content tier)
 *   .claude/agents/<name>.md   OR  evals/agents/<name>/**   → run evals/agents/<name>  (tool tier)
 *   ANY repo guide (CLAUDE.md at any depth) / any agent / engine change → run the workflow tier
 *
 * A changed artifact with NO written evals is NOT a failure: it is reported on the `skipped_*`
 * outputs so the job can print a visible "SKIP <name> (no evals)" line instead of going red.
 *
 * Emits GitHub Actions step outputs (skills, agents, run_workflow, skipped_skills, skipped_agents)
 * to $GITHUB_OUTPUT. Pure filesystem + string work — no deps.
 */

import { existsSync, readdirSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(EVALS_DIR, "..");

const changed = (process.env.CHANGED_FILES ?? "")
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);

/** Does evals/<tier>/<name>/ contain at least one *.eval.ts? */
function hasEvals(tier, name) {
  const dir = join(EVALS_DIR, tier, name);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".eval.ts"));
}

/** Collect distinct artifact names touched under a `.claude` and/or `evals` prefix. */
function touched(reClaude, reEvals) {
  const names = new Set();
  for (const f of changed) {
    const m = f.match(reClaude) ?? f.match(reEvals);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const skillNames = touched(
  /^\.claude\/skills\/([^/]+)\//,
  /^evals\/skills\/([^/]+)\//,
);
const agentNames = touched(
  /^\.claude\/agents\/([^/]+)\.md$/,
  /^evals\/agents\/([^/]+)\//,
);

const skills = skillNames.filter((n) => hasEvals("skills", n));
const skippedSkills = skillNames.filter((n) => !hasEvals("skills", n));
const agents = agentNames.filter((n) => hasEvals("agents", n));
const skippedAgents = agentNames.filter((n) => !hasEvals("agents", n));

/**
 * A CLAUDE.md the agents actually read, as opposed to one that is test data.
 *
 * The rule used to be an exact match on `CLAUDE.md` / `.claude/CLAUDE.md`, which missed the four
 * package guides — client/, e2e/, reviewer-core/, server/ — even though an agent entering those
 * directories reads them, and they carry the rules it is judged against. Editing server/CLAUDE.md
 * ran nothing at all.
 *
 * The exclusions matter as soon as this widens: eval fixtures ship their own CLAUDE.md on purpose
 * (a whole package tree with per-package guides is the artifact under test), and a vendored
 * checkout under clones/ carries someone else's. Routing either would fire the workflow tier on
 * every fixture edit and measure nothing.
 */
const NOT_A_REPO_GUIDE = [/(^|\/)fixtures\//, /(^|\/)clones\//, /^node_modules\//];
const isRepoGuide = (f) => /(^|\/)CLAUDE\.md$/.test(f) && !NOT_A_REPO_GUIDE.some((re) => re.test(f));

// The workflow tier measures the LIVE harness, so anything that changes it re-triggers it:
// any repo guide, any agent definition, the workflow cases, or the engine itself.
const guides = changed.filter(isRepoGuide);
const runWorkflow = changed.some(
  (f) =>
    isRepoGuide(f) ||
    /^\.claude\/agents\/.+\.md$/.test(f) ||
    /^evals\/workflow\//.test(f) ||
    /^evals\/src\//.test(f),
);

const out = process.env.GITHUB_OUTPUT;
const write = (k, v) => (out ? appendFileSync(out, `${k}=${v}\n`) : console.log(`${k}=${v}`));

write("skills", JSON.stringify(skills));
write("agents", JSON.stringify(agents));
write("run_workflow", String(runWorkflow));
write("skipped_skills", skippedSkills.join(" "));
write("skipped_agents", skippedAgents.join(" "));

// Human-readable summary in the step log.
console.error("── eval change detection ──");
console.error(`changed files : ${changed.length}`);
console.error(`skills → run  : ${skills.join(", ") || "(none)"}`);
console.error(`agents → run  : ${agents.join(", ") || "(none)"}`);
console.error(`workflow tier : ${runWorkflow ? "run" : "skip"}`);
if (guides.length) console.error(`repo guides   : ${guides.join(", ")}`);
if (skippedSkills.length) console.error(`SKIP skills (no evals): ${skippedSkills.join(", ")}`);
if (skippedAgents.length) console.error(`SKIP agents (no evals): ${skippedAgents.join(", ")}`);

// And on the job summary, because a skip nobody reads is indistinguishable from coverage. The
// skipped_* outputs above are consumed by later jobs; this is for the human opening the PR.
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [`### Eval routing — ${changed.length} changed file(s)`, ""];
  const ran = [
    ...skills.map((n) => `- **run** — skill \`${n}\``),
    ...agents.map((n) => `- **run** — agent \`${n}\``),
    ...(runWorkflow ? ["- **run** — workflow tier"] : []),
  ];
  lines.push(...(ran.length ? ran : ["- nothing to run"]));
  const skipped = [
    ...skippedSkills.map((n) => `| skill \`${n}\` | no evals/skills/${n}/*.eval.ts |`),
    ...skippedAgents.map((n) => `| agent \`${n}\` | no evals/agents/${n}/*.eval.ts |`),
  ];
  if (skipped.length) lines.push("", "| Skipped | Why |", "|---|---|", ...skipped);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}
