#!/usr/bin/env node
/**
 * Routes a list of changed files to the eval suites that should run for them.
 *
 * Reads paths on stdin (one per line, as `git diff --name-only` prints them) and emits a
 * single GitHub Actions matrix. The point of this file is the SKIP: most things that can
 * change here have no evals, and a change with no evals must be named in the log and
 * passed over — never guessed at, and never a failure.
 *
 *   git diff --name-only origin/main...HEAD | node skill-evals/ci/plan.mjs
 *
 * Writes `matrix` and `any` to $GITHUB_OUTPUT and the decision table to
 * $GITHUB_STEP_SUMMARY when those are set; always prints the table, so a CI log says why
 * each thing did or did not run.
 */
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

/** A suite lives at <dir>/evals/evals.json — the layout run.ts resolves for --skill. */
const hasSuite = (dir) => existsSync(path.join(REPO_ROOT, dir, 'evals/evals.json'));

/**
 * CLAUDE.md files that are test data or a vendored checkout, not instructions to the
 * agent. The fixture holds four by design; treating them as repo guides would fire the
 * guide check on every fixture edit and measure nothing.
 */
const NOT_A_REPO_GUIDE = [/^skill-evals\/fixtures\//, /(^|\/)clones\//, /^node_modules\//];

/** One cheap, stable case that proves the runner still runs when the harness changes. */
const HARNESS_SMOKE = { dir: '.claude/skills/security', cases: 'post-page-sanitizer-and-cors' };

function classify(files) {
  const rows = new Map();
  const skipped = [];
  let harness = false;
  const skip = (what, why) => {
    if (!skipped.some((s) => s.what === what)) skipped.push({ what, why });
  };

  for (const f of files) {
    // --- a skill changed: run that skill's own suite, if it has one ---
    const skill = f.match(/^\.claude\/skills\/([^/]+)\//)?.[1];
    if (skill) {
      const dir = `.claude/skills/${skill}`;
      if (hasSuite(dir)) rows.set(`skill:${skill}`, { kind: 'skill', name: skill, dir });
      else skip(`skill \`${skill}\``, `no ${dir}/evals/evals.json`);
    }

    // --- an agent changed: agent suites live outside .claude/agents, which is flat ---
    const agent = f.match(/^\.claude\/agents\/([^/]+)\.md$/)?.[1];
    if (agent && agent !== 'README') {
      const dir = `skill-evals/suites/agents/${agent}`;
      if (hasSuite(dir)) rows.set(`agent:${agent}`, { kind: 'agent', name: agent, dir });
      else skip(`agent \`${agent}\``, `no ${dir}/evals/evals.json`);
    }

    // --- a repo guide changed: one suite covers all of them, they are read together ---
    if (/(^|\/)CLAUDE\.md$/.test(f) && !NOT_A_REPO_GUIDE.some((re) => re.test(f))) {
      const dir = 'skill-evals/suites/repo-guides';
      if (hasSuite(dir)) rows.set('guide', { kind: 'guide', name: 'repo-guides', dir });
      else skip('repo guides', `no ${dir}/evals/evals.json`);
    }

    // The harness itself is the one case where nothing under test moved but the
    // measurement did.
    if (/^skill-evals\/(run\.ts|package\.json|ci\/)/.test(f)) harness = true;
  }

  // A real suite already proves the runner runs; the smoke row is only for a harness
  // change that touched nothing else.
  if (harness && rows.size === 0) {
    rows.set('harness', { kind: 'harness', name: 'smoke', runs: '1', ...HARNESS_SMOKE });
  }

  return { rows: [...rows.values()], skipped };
}

const stdin = await new Promise((res) => {
  let b = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (b += d));
  process.stdin.on('end', () => res(b));
});

const files = stdin.split('\n').map((s) => s.trim()).filter(Boolean);
const { rows, skipped } = classify(files);

const label = { skill: 'skill', agent: 'agent', guide: 'repo guides', harness: 'harness smoke' };
const lines = [`### Eval routing — ${files.length} changed file(s)`, ''];
lines.push(
  ...(rows.length
    ? rows.map((r) => `- **run** — ${label[r.kind]} \`${r.name}\``)
    : ['- nothing to run']),
);
if (skipped.length) {
  lines.push('', '| Skipped | Why |', '|---|---|');
  for (const s of skipped) lines.push(`| ${s.what} | ${s.why} |`);
}
const summary = lines.join('\n');
console.log(summary);

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `matrix=${JSON.stringify(rows)}`,
      // Guards the eval job: an empty `include` is a workflow error, not an empty run.
      `any=${rows.length > 0}`,
    ].join('\n') + '\n',
  );
}

// Written here rather than handed back as a step output: the table contains backticks and
// pipes, and echoing an output through the shell would run the backticks as a command.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
}
