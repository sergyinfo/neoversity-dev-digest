/**
 * A/B eval runner for the skills in .claude/skills.
 *
 * Cases live with each skill (<skill>/evals/evals.json) so a skill ships as one
 * directory; this file is only the harness.
 *
 * Each case runs twice — once told to read the skill, once told not to — and the
 * two reviews are graded against the same rubric. What the runner measures is the
 * DELTA between the arms, not the absolute score: a skill that changes nothing
 * scores the same in both arms and fails the gate.
 *
 * Grading is deliberately mechanical (regex over the review text). The judgment
 * calls that produced skill-evals/history/ were made by hand; anything this file
 * cannot check without judgment is left out rather than faked.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

type Arm = 'with_skill' | 'without_skill';

interface Plant {
  id: string;
  pattern: string;
}

interface Case {
  id: string;
  tier: string;
  prompt: string;
  /** Fixture paths, relative to the skill directory. */
  files: string[];
  plants: Plant[];
  decoys: string[];
}

/**
 * `<skill>/evals/evals.json`. The cases travel with the skill so it can be
 * delivered as one directory; this package only holds the harness.
 */
interface Suite {
  skill_name: string;
  description: string;
  gates: {
    withSkillRecall: number;
    withSkillLowDiscipline: number;
    minPassRateDelta: number;
  };
  evals: Case[];
}

interface Grade {
  plantsFound: string[];
  plantsMissed: string[];
  findings: number;
  lowOrInfoInFindings: number;
  decoysNamedInFindings: string[];
  assertions: { text: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
}

interface RunResult {
  caseId: string;
  arm: Arm;
  run: number;
  ok: boolean;
  error?: string;
  grade?: Grade;
  tokens: number;
  costUsd: number;
  durationMs: number;
}

/* ------------------------------------------------------------------ args -- */

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  return {
    // A bare name resolves under .claude/skills; a path is used as given.
    skill: get('--skill', 'security')!,
    tier: get('--tier', 'data-flow')!,
    runs: Number(get('--runs', '3')),
    cases: get('--cases')?.split(',').map((s) => s.trim()),
    model: get('--model', process.env.SKILL_EVALS_MODEL ?? 'opus')!,
    concurrency: Number(get('--concurrency', '4')),
    outDir: get('--out', path.join(HERE, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}`))!,
    // Re-grade reviews that already exist on disk, without calling the model.
    // Used to check the grader against a known-good corpus, and to re-score an
    // old run after the rubric changes.
    gradeOnly: get('--grade-only'),
  };
}

/* --------------------------------------------------------------- prompts -- */

function buildPrompt(c: Case, arm: Arm, skillDir: string, fixtureAbs: string, outAbs: string): string {
  const load =
    arm === 'with_skill'
      ? `STEP 1 — Load the skill you must follow:\nRead ${path.join(skillDir, 'SKILL.md')} in full and follow it. Its bundled resources (examples.md, checklists.md, references.md) live in the same directory — read them if the skill points you there.\n\nSTEP 2 — `
      : `This is a controlled baseline run. Do NOT read, load, or invoke any skill. Do not use the Skill tool. Do not read anything under ${path.join(REPO_ROOT, '.claude/skills')}. Rely solely on your own knowledge.\n\n`;

  // The cases live inside the skill so it ships as one directory — which puts the
  // answer key next to the SKILL.md the with_skill arm is told to read. Naming the
  // forbidden paths is the only thing standing between that and a leaked run.
  const evalsDir = path.join(skillDir, 'evals');

  return `You are performing a security code review.

${load}The user's request:
"${c.prompt}"

Review scope: every file under ${fixtureAbs}
Read all of them.

Deliverable:
Write your review to ${outAbs}
That file is the only deliverable.

Constraints:
- Do NOT modify any file under the fixture directory.
- Do NOT read ${path.join(evalsDir, 'answer-key.md')} or ${path.join(evalsDir, 'evals.json')} under any circumstances. They state what is planted in the fixture, and reading either invalidates this run.
- Within ${evalsDir}, read ONLY the fixture directory named above. Do not read other cases' fixtures, other runs' outputs, or any other eval metadata.
- Do NOT read anything under ${HERE}.
- Do not run the code.`;
}

/* ------------------------------------------------------------- execution -- */

function runClaude(prompt: string, model: string): Promise<{ json: any; raw: string }> {
  return new Promise((resolve, reject) => {
    // --restricted drops Bash and the other code-running tools; the executor only
    // needs to read the fixture and write one file. bypassPermissions is rejected
    // in restricted mode, so acceptEdits is the mode that actually works here.
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--restricted',
      '--allowed-tools',
      'Read Glob Grep Write',
      '--permission-mode',
      'acceptEdits',
      '--model',
      model,
    ];
    // CLAUDECODE is set when this runs inside a Claude Code session; it guards
    // against interactive nesting, which does not apply to a subprocess.
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', args, { cwd: REPO_ROOT, env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.trim() || out.trim()}`));
      try {
        resolve({ json: JSON.parse(out), raw: out });
      } catch {
        reject(new Error(`unparseable claude output: ${out.slice(0, 400)}`));
      }
    });
  });
}

/* --------------------------------------------------------------- grading -- */

const SEVERITY_CELL = /^\**\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*\**$/i;
const FINDING_HEADING = /^#{2,4}\s*(\d+[.)]|[A-Z]-?\d+|F-\d+)/;

/**
 * Everything before the first "these are not findings" style heading. Both arms
 * consistently park below-the-bar material under such a heading, and counting it
 * as findings would erase the exact difference the suite is trying to measure.
 */
function findingsRegion(text: string): string {
  const cut = text.search(
    /^#{1,3}\s.*(not counted as findings|lower.confidence|not reported|checked and|verified.safe|verified as sound|found sound|what (the )?(code|service|this).*(right|sound)|deliberately not flagged|out of scope|could not verify|notes for manual)/im
  );
  return cut > 0 ? text.slice(0, cut) : text;
}

/**
 * Reviews list each finding twice — once as a summary-table row, once as its own
 * section heading. Counting both double-counts every finding, so the two shapes
 * are tallied separately and the richer one wins.
 */
function tallyFindings(region: string): { rows: string[]; count: number; severities: Record<string, number> } {
  const tableRows: string[] = [];
  const tableSev: Record<string, number> = {};
  const headingRows: string[] = [];
  const headingSev: Record<string, number> = {};

  for (const line of region.split('\n')) {
    const s = line.trim();

    if (s.startsWith('|')) {
      for (const cell of s.replace(/^\||\|$/g, '').split('|')) {
        const m = SEVERITY_CELL.exec(cell.trim());
        if (m) {
          tableRows.push(s);
          const k = m[1].toLowerCase();
          tableSev[k] = (tableSev[k] ?? 0) + 1;
          break;
        }
      }
      continue;
    }

    if (FINDING_HEADING.test(s)) {
      headingRows.push(s);
      const m = /\b(CRITICAL|HIGH|MEDIUM|LOW|INFO)\b/i.exec(s);
      if (m) {
        const k = m[1].toLowerCase();
        headingSev[k] = (headingSev[k] ?? 0) + 1;
      }
    }
  }

  const useTable = tableRows.length >= headingRows.length;
  return {
    rows: useTable ? tableRows : headingRows,
    count: Math.max(tableRows.length, headingRows.length),
    severities: useTable ? tableSev : headingSev,
  };
}

function grade(c: Case, review: string): Grade {
  const region = findingsRegion(review);
  const { rows, count: findings, severities: sev } = tallyFindings(region);
  const low = (sev.low ?? 0) + (sev.info ?? 0);

  const found = c.plants.filter((p) => new RegExp(p.pattern, 'i').test(region)).map((p) => p.id);
  const missed = c.plants.filter((p) => !found.includes(p.id)).map((p) => p.id);

  const decoyRe = new RegExp(c.decoys.join('|'), 'i');
  const decoyRows = rows.filter((r) => decoyRe.test(r) && !/low|info/i.test(r));

  const assertions = [
    {
      text: 'All planted issues are reported',
      passed: missed.length === 0,
      evidence: missed.length === 0 ? `found: ${found.join(', ')}` : `missed: ${missed.join(', ')}`,
    },
    {
      text: 'No control that is correct as written is filed as a finding',
      passed: decoyRows.length === 0,
      evidence: decoyRows.length === 0 ? 'no decoy named in a finding title' : decoyRows.join(' // '),
    },
    {
      text: "No LOW/Info item sits in the findings list (the skill's rule is LOW -> do not report)",
      passed: low === 0,
      evidence: `${findings} findings, ${low} rated LOW/Info inside the findings list`,
    },
    {
      text: 'The review reports at least one finding with a severity label',
      passed: findings > 0,
      evidence: JSON.stringify(sev),
    },
  ];

  return {
    plantsFound: found,
    plantsMissed: missed,
    findings,
    lowOrInfoInFindings: low,
    decoysNamedInFindings: decoyRows,
    assertions,
    passed: assertions.filter((a) => a.passed).length,
    total: assertions.length,
  };
}

/* ------------------------------------------------------------------- run -- */

async function pool<T>(items: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await items[i]();
      }
    })
  );
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const skillDir = args.skill.includes('/')
    ? path.resolve(REPO_ROOT, args.skill)
    : path.join(REPO_ROOT, '.claude/skills', args.skill);
  const suite: Suite = JSON.parse(await readFile(path.join(skillDir, 'evals/evals.json'), 'utf8'));

  // --cases names them explicitly; otherwise the tier decides. The gates are
  // calibrated on the data-flow tier, so that is the default.
  const cases = args.cases
    ? suite.evals.filter((c) => args.cases!.includes(c.id))
    : suite.evals.filter((c) => c.tier === args.tier);

  if (cases.length === 0)
    throw new Error(`no cases matched ${args.cases ? `--cases=${args.cases.join(',')}` : `--tier=${args.tier}`}`);

  if (args.gradeOnly) {
    const report = summarise(suite, await gradeExisting(cases, args.gradeOnly));
    console.log(renderMarkdown(suite, report));
    if (report.gateFailures.length > 0) {
      console.error(`\nFAILED gates:\n  - ${report.gateFailures.join('\n  - ')}`);
      process.exit(1);
    }
    return;
  }

  console.log(`skill: ${suite.skill_name} (${skillDir})`);
  console.log(`cases: ${cases.map((c) => c.id).join(', ')} — 2 arms x ${args.runs} run(s), model=${args.model}`);
  console.log(`out:   ${args.outDir}\n`);

  const jobs: (() => Promise<RunResult>)[] = [];
  for (const c of cases) {
    for (const arm of ['with_skill', 'without_skill'] as Arm[]) {
      for (let run = 1; run <= args.runs; run++) {
        jobs.push(async () => {
          const dir = path.join(args.outDir, c.id, arm, `run-${run}`);
          await mkdir(dir, { recursive: true });
          const reviewPath = path.join(dir, 'review.md');
          const prompt = buildPrompt(c, arm, skillDir, path.join(skillDir, c.files[0]), reviewPath);

          const label = `${c.id} ${arm} run-${run}`;
          try {
            const { json } = await runClaude(prompt, args.model);
            const review = await readFile(reviewPath, 'utf8').catch(() => '');
            if (!review.trim()) throw new Error('executor wrote no review');

            const g = grade(c, review);
            const u = json.usage ?? {};
            const res: RunResult = {
              caseId: c.id,
              arm,
              run,
              ok: true,
              grade: g,
              tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
              costUsd: json.total_cost_usd ?? 0,
              durationMs: json.duration_ms ?? 0,
            };
            await writeFile(path.join(dir, 'grading.json'), JSON.stringify({ ...res, sessionId: json.session_id }, null, 2));
            console.log(`  [${g.passed}/${g.total}] ${label} — ${g.findings} findings, ${g.lowOrInfoInFindings} LOW/Info`);
            return res;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`  [ERR ] ${label} — ${msg}`);
            return { caseId: c.id, arm, run, ok: false, error: msg, tokens: 0, costUsd: 0, durationMs: 0 };
          }
        });
      }
    }
  }

  const results = await pool(jobs, args.concurrency);
  const report = summarise(suite, results);
  await writeFile(path.join(args.outDir, 'benchmark.json'), JSON.stringify(report, null, 2));
  await writeFile(path.join(args.outDir, 'benchmark.md'), renderMarkdown(suite, report));
  console.log(`\n${renderMarkdown(suite, report)}`);

  if (report.gateFailures.length > 0) {
    console.error(`\nFAILED gates:\n  - ${report.gateFailures.join('\n  - ')}`);
    process.exit(1);
  }
  console.log('\nAll gates passed.');
}

/**
 * Grade review.md files that already exist under `dir`. Any layout works as long
 * as the path contains the case id, the arm, and a run-N segment.
 */
async function gradeExisting(cases: Case[], dir: string): Promise<RunResult[]> {
  const { glob } = await import('node:fs/promises');
  const out: RunResult[] = [];
  for await (const entry of glob('**/review.md', { cwd: dir })) {
    const rel = String(entry);
    const c = cases.find((x) => rel.includes(x.id));
    const arm: Arm | undefined = rel.includes('without_skill')
      ? 'without_skill'
      : rel.includes('with_skill')
        ? 'with_skill'
        : undefined;
    if (!c || !arm) continue;
    const run = Number(/run-(\d+)/.exec(rel)?.[1] ?? 1);
    const g = grade(c, await readFile(path.join(dir, rel), 'utf8'));
    out.push({ caseId: c.id, arm, run, ok: true, grade: g, tokens: 0, costUsd: 0, durationMs: 0 });
    console.log(
      `  [${g.passed}/${g.total}] ${c.id} ${arm} run-${run} — ${g.findings} findings, ${g.lowOrInfoInFindings} LOW/Info` +
        (g.plantsMissed.length ? `, MISSED ${g.plantsMissed.join('+')}` : '')
    );
  }
  return out;
}

function summarise(suite: Suite, results: RunResult[]) {
  const arm = (a: Arm) => results.filter((r) => r.arm === a && r.ok && r.grade);
  const rate = (a: Arm) => {
    const rs = arm(a);
    if (rs.length === 0) return 0;
    return rs.reduce((s, r) => s + r.grade!.passed, 0) / rs.reduce((s, r) => s + r.grade!.total, 0);
  };
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sd = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
  };

  const stats = (a: Arm) => {
    const rs = arm(a);
    const f = rs.map((r) => r.grade!.findings);
    return {
      runs: rs.length,
      passRate: rate(a),
      recall: rs.length ? rs.filter((r) => r.grade!.plantsMissed.length === 0).length / rs.length : 0,
      lowDiscipline: rs.length ? rs.filter((r) => r.grade!.lowOrInfoInFindings === 0).length / rs.length : 0,
      findingsMean: mean(f),
      findingsSd: sd(f),
      findingsTotal: f.reduce((a, b) => a + b, 0),
      tokensMean: mean(rs.map((r) => r.tokens)),
      costUsd: rs.reduce((s, r) => s + r.costUsd, 0),
      durationMean: mean(rs.map((r) => r.durationMs)),
    };
  };

  const withSkill = stats('with_skill');
  const without = stats('without_skill');
  const failures: string[] = [];
  const errored = results.filter((r) => !r.ok);
  if (errored.length) failures.push(`${errored.length} run(s) errored`);
  if (withSkill.recall < suite.gates.withSkillRecall)
    failures.push(`with_skill recall ${withSkill.recall.toFixed(2)} < ${suite.gates.withSkillRecall}`);
  if (withSkill.lowDiscipline < suite.gates.withSkillLowDiscipline)
    failures.push(`with_skill LOW discipline ${withSkill.lowDiscipline.toFixed(2)} < ${suite.gates.withSkillLowDiscipline}`);
  const delta = withSkill.passRate - without.passRate;
  if (delta < suite.gates.minPassRateDelta)
    failures.push(`pass-rate delta ${delta.toFixed(2)} < ${suite.gates.minPassRateDelta} — the skill is not earning its keep`);

  return { skill: suite.skill_name, withSkill, without, delta, gateFailures: failures, results };
}

function renderMarkdown(suite: Suite, r: ReturnType<typeof summarise>): string {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const w = r.withSkill;
  const b = r.without;
  return [
    `# Skill eval: ${suite.skill_name}`,
    '',
    `${suite.description}`,
    '',
    '| Metric | With skill | Without skill | Delta |',
    '|---|---|---|---|',
    `| Pass rate | ${pct(w.passRate)} | ${pct(b.passRate)} | ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)} |`,
    `| Recall (all plants found) | ${pct(w.recall)} | ${pct(b.recall)} | |`,
    `| LOW discipline | ${pct(w.lowDiscipline)} | ${pct(b.lowDiscipline)} | |`,
    `| Findings per review | ${w.findingsMean.toFixed(1)} ± ${w.findingsSd.toFixed(1)} | ${b.findingsMean.toFixed(1)} ± ${b.findingsSd.toFixed(1)} | |`,
    `| Signal density | ${pct(w.findingsTotal ? (w.runs * 3) / w.findingsTotal : 0)} | ${pct(b.findingsTotal ? (b.runs * 3) / b.findingsTotal : 0)} | |`,
    `| Tokens per run | ${Math.round(w.tokensMean).toLocaleString()} | ${Math.round(b.tokensMean).toLocaleString()} | |`,
    `| Wall clock per run | ${(w.durationMean / 1000).toFixed(0)}s | ${(b.durationMean / 1000).toFixed(0)}s | |`,
    `| Cost | $${w.costUsd.toFixed(2)} | $${b.costUsd.toFixed(2)} | |`,
    '',
    r.gateFailures.length ? `**Gates failed:** ${r.gateFailures.join('; ')}` : '**All gates passed.**',
  ].join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
