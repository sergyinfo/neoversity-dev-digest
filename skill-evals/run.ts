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

/** Resolved per suite: with_skill/without_skill, or new_skill/old_skill in snapshot mode. */
type Arm = string;

interface Plant {
  id: string;
  /** Required by the regex grader; the agent grader uses `describe` instead. */
  pattern?: string;
  /** Optional grouping so recall can be reported per kind of violation. */
  category?: string;
  /**
   * Prose statement of the defect, for the agent grader. Nine plant patterns in a row
   * missed a finding that was filed under wording the regex did not carry, so what a
   * plant *is* belongs in a sentence, not in an alternation.
   */
  describe?: string;
  /**
   * Match only against finding titles, not the whole findings region. Use this whenever
   * the skill teaches the fact in words a faithful report will quote — a title is the
   * reviewer's own summary, so the skill's prose cannot reach it without the reviewer
   * actually filing the finding.
   */
  titleOnly?: boolean;
}

interface Case {
  id: string;
  tier: string;
  prompt: string;
  /** Fixture paths, relative to the skill directory. */
  files: string[];
  /** Replaces the default "read every file under X" line — for repo-wide cases. */
  scope?: string;
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
  /**
   * Repo-relative path to a frozen earlier version of the skill. When set, the
   * baseline arm reads THAT skill instead of being told to read none — this is
   * "is v2 better than v1", not "is the skill better than nothing".
   */
  baselineSkill?: string;
  baselineLabel?: string;
  /** What kind of review the executor is asked for: "security", "architecture", ... */
  reviewKind?: string;
  /** 'regex' (cheap, brittle) or 'agent' (reads the review and judges). */
  grader?: 'regex' | 'agent' | 'stored';
  /**
   * Whether "no LOW/Info item in the findings list" applies. It comes from the security
   * skill, which says LOW -> do not report. A skill that prescribes a low-severity tier
   * of its own — dependency-checker has P3 — is penalised by it for following its own
   * template, so it must be switched off there. Defaults to on.
   */
  lowDisciplineApplies?: boolean;
  /**
   * Tools the executor gets. Defaults to a read-only set under --restricted. A skill
   * whose procedure runs a bundled script needs Bash, and BOTH arms must get it or the
   * comparison measures tool access rather than the skill.
   */
  executorTools?: string[];
  gates: {
    withSkillRecall?: number;
    withSkillLowDiscipline?: number;
    minPassRateDelta?: number;
    /** Recall the treatment arm must reach, per plant category. */
    newSkillCategoryRecall?: Record<string, number>;
    /** How far the treatment must beat the baseline, per category — the delta under test. */
    minCategoryRecallDelta?: Record<string, number>;
    /** How far the arms may drift on a category that is supposed to be a control. */
    maxCategoryRecallDelta?: Record<string, number>;
  };
  evals: Case[];
}

function armsFor(suite: Suite): { treatment: Arm; baseline: Arm } {
  return suite.baselineSkill
    ? { treatment: 'new_skill', baseline: suite.baselineLabel ?? 'old_skill' }
    : { treatment: 'with_skill', baseline: 'without_skill' };
}

interface Grade {
  /** Findings that cite the right place and rest on a false premise. Agent grader only. */
  falseClaims?: { claim: string; why: string }[];
  plantsFound: string[];
  plantsMissed: string[];
  /** category -> [found, total]. Empty when the suite does not categorise plants. */
  categoryRecall: Record<string, [number, number]>;
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
    // No default: 'data-flow' only exists in one suite, so hardcoding it made every
    // command fail for the others, --print-prompt included. Absent --tier means all cases.
    tier: get('--tier'),
    // Two per arm by default. Enough to screen a rule — a real effect shows as 2/2 vs
    // 0/2 — and not enough to trust a small delta, which is what --runs 5 is for.
    runs: Number(get('--runs', '2')),
    cases: get('--cases')?.split(',').map((s) => s.trim()),
    model: get('--model', process.env.SKILL_EVALS_MODEL ?? 'opus')!,
    concurrency: Number(get('--concurrency', '4')),
    // Must be absolute: the executor runs with cwd=REPO_ROOT and is handed this path
    // in its prompt, so a relative --out would have it write somewhere the runner
    // never looks. The CI workflow passes a relative path, so this is load-bearing.
    outDir: path.resolve(HERE, get('--out', path.join(HERE, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}`))!),
    // Re-grade reviews that already exist on disk, without calling the model.
    // Used to check the grader against a known-good corpus, and to re-score an
    // old run after the rubric changes.
    gradeOnly: get('--grade-only'),
    // Re-run one side only. Half a matrix dying to a transient failure is common
    // enough that repeating the surviving half is pure waste.
    arm: get('--arm'),
    grader: get('--grader') as 'regex' | 'agent' | 'stored' | undefined,
    graderModel: get('--grader-model', process.env.SKILL_EVALS_GRADER_MODEL ?? 'opus')!,
    // Print the prompt for the first case in each arm and exit. Cheap way to see
    // exactly what an executor is told before spending a run on it.
    printPrompt: argv.includes('--print-prompt'),
  };
}

/* --------------------------------------------------------------- prompts -- */

function buildPrompt(
  c: Case,
  arm: Arm,
  reviewKind: string,
  mayRunCode: boolean,
  skillDir: string,
  fixtureAbs: string,
  outAbs: string,
  isTreatment: boolean,
  baselineSkillDir?: string
): string {
  const readSkill = (dir: string) =>
    `STEP 1 — Load the skill you must follow:\nRead ${path.join(dir, 'SKILL.md')} in full and follow it. Any bundled resources live in the same directory — read them if the skill points you there.\n\nSTEP 2 — `;

  // Three shapes: the version under test, an older version of the same skill, or no
  // skill at all. In snapshot mode each arm must be blind to the other's version, or
  // the delta being measured leaks across.
  const load = isTreatment
    ? readSkill(skillDir)
    : baselineSkillDir
      ? `${readSkill(baselineSkillDir)}`
      : `This is a controlled baseline run. Do NOT read, load, or invoke any skill. Do not use the Skill tool. Do not read anything under ${path.join(REPO_ROOT, '.claude/skills')}. Rely solely on your own knowledge.\n\n`;

  // Ban the other version's SKILL.md by file, never by directory: in snapshot mode the
  // treatment skill's directory also contains the fixture the executor must read, so a
  // directory-wide ban tells it to read and not read the same tree.
  const otherSkillFile = baselineSkillDir
    ? path.join(isTreatment ? baselineSkillDir : skillDir, 'SKILL.md')
    : undefined;

  // The cases live inside the skill so it ships as one directory — which puts the
  // answer key next to the SKILL.md the with_skill arm is told to read. Naming the
  // forbidden paths is the only thing standing between that and a leaked run.
  const evalsDir = path.join(skillDir, 'evals');

  return `You are performing ${reviewKind === 'architecture' ? 'an' : 'a'} ${reviewKind} code review.

${load}The user's request:
"${c.prompt}"

${c.scope ? c.scope.replaceAll('<FIXTURE>', fixtureAbs) : `Review scope: every file under ${fixtureAbs}\nRead all of them.`}

Deliverable:
Write your review to ${outAbs}
That file is the only deliverable.

Constraints:
- Do NOT modify any file under the fixture directory.${
    otherSkillFile
      ? `\n- Do NOT read ${otherSkillFile}. It is a different version of this skill, you are being measured against it, and reading it destroys the measurement. This applies to that one file only — everything else you are told to read below is fine.`
      : ''
  }
- Do NOT read ${path.join(evalsDir, 'answer-key.md')} or ${path.join(evalsDir, 'evals.json')} under any circumstances. They state what is planted in the fixture, and reading either invalidates this run.
- Within ${evalsDir}, read ONLY the fixture directory named above. Do not read other cases' fixtures, other runs' outputs, or any other eval metadata.
- Do NOT read any other run's review.md under ${path.join(HERE, 'results')} — each run must be independent.${
    mayRunCode
      ? '\n- You may run read-only commands to measure things. Do not modify, install or build anything.'
      : '\n- Do not run the code.'
  }`;
}

/* ------------------------------------------------------------- execution -- */

/** How many times one executor run may be attempted before it counts as errored. */
const EXECUTOR_ATTEMPTS = Number(process.env.EVAL_EXECUTOR_ATTEMPTS ?? 2);

/** Wall-clock cap on one executor run. Override with EVAL_RUN_TIMEOUT_MIN. */
const RUN_TIMEOUT_MS = Number(process.env.EVAL_RUN_TIMEOUT_MIN ?? 15) * 60_000;

function runClaude(
  prompt: string,
  model: string,
  tools?: string[]
): Promise<{ json: any; raw: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    // --restricted drops Bash and the other code-running tools; the executor only
    // needs to read the fixture and write one file. bypassPermissions is rejected
    // in restricted mode, so acceptEdits is the mode that actually works here.
    const allowed = tools ?? ['Read', 'Glob', 'Grep', 'Write'];
    const needsCode = allowed.some((t) => /^(Bash|NotebookEdit)/.test(t));
    const args = [
      '-p',
      prompt,
      '--output-format',
      'json',
      // --restricted strips the code-running tools, so it cannot coexist with Bash.
      ...(needsCode ? [] : ['--restricted']),
      '--allowed-tools',
      allowed.join(' '),
      '--permission-mode',
      'acceptEdits',
      '--model',
      model,
    ];
    // CLAUDECODE is set when this runs inside a Claude Code session; it guards
    // against interactive nesting, which does not apply to a subprocess.
    const env = { ...process.env };
    delete env.CLAUDECODE;

    // stdin must be closed, not left as an unwritten pipe: the CLI waits 3s for input
    // and then exits 1. It is a race — light runs survive it, concurrent ones do not.
    const child = spawn('claude', args, { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';

    // A misconfigured endpoint does not fail — it hangs. Pointed at a gateway with no
    // usable credentials the CLI produced no output and no exit for minutes, and with
    // nothing bounding it here a few such runs would consume the whole CI job and leave
    // no benchmark to explain why. The cap is generous: the slowest real run measured is
    // the dependency-checker repo audit at ~7 minutes.
    let timer: NodeJS.Timeout | undefined;
    const done = () => clearTimeout(timer);
    timer = setTimeout(() => {
      child.kill('SIGTERM');
      // SIGTERM is a request. Escalate rather than trade one hang for another.
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
      reject(
        new Error(
          `claude produced no exit within ${RUN_TIMEOUT_MS / 60_000} min (model=${model}). ` +
            `Wrote ${out.length} bytes. A hang here is usually auth or a base URL that ` +
            `accepts the connection but never answers — check the endpoint before the suite.`,
        ),
      );
    }, RUN_TIMEOUT_MS);
    timer.unref();

    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      done();
      reject(e);
    });
    child.on('close', (code) => {
      done();
      // A non-zero exit does not mean nothing happened: runs have written a complete
      // review and then exited 1. Whether the run is usable is decided by the caller,
      // from the output on disk.
      try {
        resolve({ json: JSON.parse(out), raw: out, exitCode: code ?? 0 });
      } catch {
        reject(new Error(`claude exited ${code} with unparseable output: ${(err || out).trim().slice(0, 300)}`));
      }
    });
  });
}

/* --------------------------------------------------------------- grading -- */

const SEVERITY_CELL = /^\**\s*(CRITICAL|HIGH|MEDIUM|LOW|INFO)\s*\**$/i;
// Reviews label findings three ways: a markdown heading, a bold lead-in (**F1. …**),
// or a summary-table row. All three are titles; only the first was recognised.
// Two shapes, and the explicit one wins. A report that labels findings F1, F2, … is
// telling you exactly which lines are findings; counting generic numbered headings as
// well picks up the report's own section numbering ("## 1. Summary") and its severity
// tiers ("### P1 —"). The better the skill structures the report, the worse that gets.
const FINDING_LABEL = /^(?:#{2,4}\s*|\*\*)(?:finding\s*)?F-?\d+[.)—:\s]/i;
const FINDING_HEADING = /^#{2,4}\s*(?:finding\s*)?(\d+[.)—-]|[A-Z]-?\d+|F-?\d+)/i;

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
  // Decide once per document which shape it uses.
  const labelled = region.split('\n').some((l) => FINDING_LABEL.test(l.trim()));
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

    if (labelled ? FINDING_LABEL.test(s) : FINDING_HEADING.test(s)) {
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

function grade(c: Case, review: string, lowDisciplineApplies: boolean): Grade {
  const region = findingsRegion(review);
  const { rows, count: findings, severities: sev } = tallyFindings(region);
  const low = (sev.low ?? 0) + (sev.info ?? 0);

  const titles = rows.join('\n');
  const hit = (p: Plant) => Boolean(p.pattern) && new RegExp(p.pattern!, 'i').test(p.titleOnly ? titles : region);
  const found = c.plants.filter(hit).map((p) => p.id);
  const missed = c.plants.filter((p) => !found.includes(p.id)).map((p) => p.id);

  const categoryRecall: Record<string, [number, number]> = {};
  for (const p of c.plants) {
    if (!p.category) continue;
    const [f, t] = categoryRecall[p.category] ?? [0, 0];
    categoryRecall[p.category] = [f + (hit(p) ? 1 : 0), t + 1];
  }

  const decoyRe = new RegExp(c.decoys.join('|'), 'i');
  const decoyRows = rows.filter((r) => decoyRe.test(r) && !/low|info/i.test(r));

  return finishGrade(c, lowDisciplineApplies, {
    plantsFound: found,
    plantsMissed: missed,
    findings,
    lowOrInfoInFindings: low,
    decoysNamedInFindings: decoyRows,
  });
}

/**
 * A plant pattern that matches the skill's own text scores the skill for reciting
 * itself. This is how a dependency-checker run once read 5/5 on a plant it had found
 * once: the pattern matched a sentence SKILL.md instructs the reviewer to write.
 *
 * Not fatal — a skill legitimately names the things it tells you to look for — but it
 * has to be visible, so it is printed at startup and recorded in the benchmark.
 */
async function patternsEchoingSkill(
  cases: Case[],
  skillDir: string
): Promise<{ caseId: string; plant: string; pattern: string; excerpt: string }[]> {
  let skillText = '';
  try {
    skillText = await readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
  } catch {
    return [];
  }
  const out: { caseId: string; plant: string; pattern: string; excerpt: string }[] = [];
  for (const c of cases) {
    for (const p of c.plants) {
      if (!p.pattern) continue;
      const m = new RegExp(p.pattern, 'i').exec(skillText);
      if (m) {
        const at = Math.max(0, m.index - 40);
        out.push({
          caseId: c.id,
          plant: p.id,
          pattern: p.pattern,
          excerpt: skillText.slice(at, m.index + m[0].length + 40).replace(/\s+/g, ' '),
        });
      }
    }
  }
  return out;
}



/** The rubric. Both graders feed it; neither gets to invent its own scoring. */
function finishGrade(
  c: Case,
  lowDisciplineApplies: boolean,
  raw: {
    plantsFound: string[];
    plantsMissed: string[];
    findings: number;
    lowOrInfoInFindings: number;
    decoysNamedInFindings: string[];
    falseClaims?: { claim: string; why: string }[];
  }
): Grade {
  const categoryRecall: Record<string, [number, number]> = {};
  for (const p of c.plants) {
    if (!p.category) continue;
    const [f, t] = categoryRecall[p.category] ?? [0, 0];
    categoryRecall[p.category] = [f + (raw.plantsFound.includes(p.id) ? 1 : 0), t + 1];
  }

  const assertions = [
    {
      text: 'All planted issues are reported',
      passed: raw.plantsMissed.length === 0,
      evidence: raw.plantsMissed.length === 0 ? `found: ${raw.plantsFound.join(', ')}` : `missed: ${raw.plantsMissed.join(', ')}`,
    },
    {
      text: 'No control that is correct as written is filed as a finding',
      passed: raw.decoysNamedInFindings.length === 0,
      evidence: raw.decoysNamedInFindings.length === 0 ? 'no control filed as a finding' : raw.decoysNamedInFindings.join(' // '),
    },
    ...(lowDisciplineApplies
      ? [
          {
            text: "No LOW/Info item sits in the findings list (the skill's rule is LOW -> do not report)",
            passed: raw.lowOrInfoInFindings === 0,
            evidence: `${raw.findings} findings, ${raw.lowOrInfoInFindings} rated LOW/Info`,
          },
        ]
      : []),
    {
      text: 'No finding rests on a false premise',
      passed: (raw.falseClaims ?? []).length === 0,
      evidence: (raw.falseClaims ?? []).length === 0 ? 'no false claim found' : (raw.falseClaims ?? []).map((f) => f.claim).join(' // '),
    },
  ];

  return {
    ...raw,
    categoryRecall,
    assertions,
    passed: assertions.filter((a) => a.passed).length,
    total: assertions.length,
  } as Grade;
}

/* -------------------------------------------------------- agent grading -- */

/**
 * Grade one review with a subagent instead of a regex.
 *
 * The agent decides only two things: was each planted defect *filed as a finding*, and
 * was any correct-as-written control filed as one. Everything else — the assertions, the
 * pass rate, the gates — stays in code, so the rubric lives in one place and two runs
 * remain comparable.
 *
 * It gets Bash on purpose. The one failure class nothing else caught was a finding that
 * was correctly located, correctly severity-rated, and resting on a false premise; the
 * only way that surfaced was an agent executing the claimed payload.
 */
async function gradeWithAgent(
  c: Case,
  reviewPath: string,
  fixtureAbs: string,
  model: string
): Promise<Partial<Grade> & { plantsFound: string[]; plantsMissed: string[] }> {
  const plants = c.plants
    .map((p) => `  - id "${p.id}": ${p.describe ?? `matches /${p.pattern}/`}`)
    .join('\n');
  const decoys = (c.decoys ?? []).map((d) => `  - ${d}`).join('\n');

  const prompt = `You are grading one code review against a known list of planted defects.

The review: ${reviewPath}
The code it reviews: ${fixtureAbs}

Planted defects — decide for each whether the review FILED IT AS A FINDING:
${plants}

Controls that are correct as written. If the review files one of these as a defect, that is a false positive:
${decoys || '  (none)'}

Rules:
- "Filed as a finding" means the review asserts it is a problem, in its findings list.
  Mentioning the code, quoting it, or listing it under "checked and correct" is NOT filing it.
- Wording will not match mine. Judge the claim, not the phrasing.
- You may read the code and RUN read-only commands to check whether a claim is actually
  true. A finding can cite the right line, carry a working fix, and rest on a false
  premise — say so in falseClaims when you find one.
- Count findings as the review itself presents them. Section headings, severity tier
  headers and summary rows are not findings.

Reply with ONLY this JSON, no prose around it:
{"plants":[{"id":"...","found":true,"evidence":"the finding title or sentence, quoted"}],
 "decoysFiledAsFindings":[{"decoy":"...","evidence":"..."}],
 "findingsCount":0,
 "lowOrInfoCount":0,
 "falseClaims":[{"claim":"...","why":"..."}]}`;

  // A dropped connection mid-grade costs a whole run, and the review is already written
  // and paid for. One retry is far cheaper than re-running the executor.
  let v: any;
  for (let attempt = 1; ; attempt += 1) {
    const { json } = await runClaude(prompt, model, ['Read', 'Glob', 'Grep', 'Bash']);
    const text: string = json.result ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      v = JSON.parse(m[0]);
      break;
    }
    if (attempt >= 2) throw new Error(`grader returned no JSON: ${text.slice(0, 200)}`);
    console.log(`  [retry] grader produced no JSON, retrying once`);
  }

  const found: string[] = (v.plants ?? []).filter((p: any) => p.found).map((p: any) => p.id);
  return {
    plantsFound: found,
    plantsMissed: c.plants.map((p) => p.id).filter((id) => !found.includes(id)),
    findings: v.findingsCount ?? 0,
    lowOrInfoInFindings: v.lowOrInfoCount ?? 0,
    decoysNamedInFindings: (v.decoysFiledAsFindings ?? []).map((d: any) => `${d.decoy}: ${d.evidence}`),
    falseClaims: v.falseClaims ?? [],
  } as any;
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

  // --cases names them explicitly, --tier narrows to one tier, and neither means every
  // case in the suite. There is deliberately no default tier: the previous default named
  // a tier that exists in one suite only, so every command failed for the others.
  const cases = args.cases
    ? suite.evals.filter((c) => args.cases!.includes(c.id))
    : args.tier
      ? suite.evals.filter((c) => c.tier === args.tier)
      : suite.evals;

  if (!args.cases && !args.tier) {
    const tiers = [...new Set(cases.map((c) => c.tier))];
    console.log(`tiers: ${tiers.join(', ')} — all cases (gates are calibrated per tier; pass --tier to narrow)`);
  }

  const graderMode = args.grader ?? suite.grader ?? 'regex';
  const useAgentGrader = graderMode === 'agent';
  const lowApplies = suite.lowDisciplineApplies !== false;

  if (cases.length === 0)
    throw new Error(`no cases matched ${args.cases ? `--cases=${args.cases.join(',')}` : `--tier=${args.tier}`}. Suite has: ${[...new Set(suite.evals.map((c) => c.tier))].join(', ')}`);

  if (args.gradeOnly) {
    const report = summarise(
      suite,
      await gradeExisting(cases, args.gradeOnly, armsFor(suite), {
        agent: useAgentGrader,
        stored: graderMode === 'stored',
        skillDir,
        model: args.graderModel,
        lowApplies,
      }),
      args.model
    );
    console.log(renderMarkdown(suite, report));
    if (report.gateFailures.length > 0) {
      console.error(`\nFAILED gates:\n  - ${report.gateFailures.join('\n  - ')}`);
      process.exit(1);
    }
    return;
  }

  const arms = armsFor(suite);
  const baselineSkillDir = suite.baselineSkill
    ? path.resolve(REPO_ROOT, suite.baselineSkill)
    : undefined;

  const echoes = await patternsEchoingSkill(cases, skillDir);
  if (echoes.length) {
    console.log("\n!! plant patterns that also match the skill's own text:");
    for (const e of echoes)
      console.log(`   ${e.caseId}/${e.plant}  /${e.pattern}/\n      …${e.excerpt}…`);
    console.log('   A review reciting the skill scores these. Use titleOnly, or tighten them.\n');
  }

  if (args.printPrompt) {
    for (const arm of [arms.treatment, arms.baseline].filter((a) => !args.arm || a === args.arm)) {
      console.log(`\n========== ${arm} ==========\n`);
      console.log(
        buildPrompt(cases[0], arm, suite.reviewKind ?? 'code',
          (suite.executorTools ?? []).some((t) => /^Bash/.test(t)), skillDir, path.join(skillDir, cases[0].files[0]),
          path.join(args.outDir, cases[0].id, arm, 'run-1', 'review.md'),
          arm === arms.treatment, baselineSkillDir)
      );
    }
    return;
  }

  console.log(`skill: ${suite.skill_name} (${skillDir})`);
  console.log(
    `arms:  ${arms.treatment} vs ${arms.baseline}` +
      (baselineSkillDir ? ` (baseline reads ${path.relative(REPO_ROOT, baselineSkillDir)})` : '')
  );
  console.log(`cases: ${cases.map((c) => c.id).join(', ')} — 2 arms x ${args.runs} run(s), model=${args.model}`);
  console.log(`out:   ${args.outDir}\n`);

  const jobs: (() => Promise<RunResult>)[] = [];
  for (const c of cases) {
    for (const arm of [arms.treatment, arms.baseline].filter((a) => !args.arm || a === args.arm)) {
      for (let run = 1; run <= args.runs; run++) {
        jobs.push(async () => {
          const dir = path.join(args.outDir, c.id, arm, `run-${run}`);
          await mkdir(dir, { recursive: true });
          const reviewPath = path.join(dir, 'review.md');
          const fixtureAbs = path.join(skillDir, c.files[0]);
          const prompt = buildPrompt(
            c,
            arm,
            suite.reviewKind ?? 'code',
            (suite.executorTools ?? []).some((t) => /^Bash/.test(t)),
            skillDir,
            fixtureAbs,
            reviewPath,
            arm === arms.treatment,
            baselineSkillDir
          );

          const label = `${c.id} ${arm} run-${run}`;
          try {
            let json: any;
            let exitCode = 0;
            let review = '';
            // Weaker models end their turn without ever calling Write: the API answers,
            // the CLI reports `completed`, and no review exists. Left alone that scores
            // zero, and because it lands on the unstructured baseline far more often than
            // on the arm holding a step-by-step skill, it inflates the delta in the
            // skill's favour — the harness would report an effect it did not measure.
            // One retry. Retries are logged, never silent: a suite that needs them is
            // telling you something about the model.
            for (let attempt = 1; ; attempt++) {
              ({ json, exitCode } = await runClaude(prompt, args.model, suite.executorTools));
              review = await readFile(reviewPath, 'utf8').catch(() => '');
              if (review.trim()) break;

              // A run that writes no review leaves nothing behind to diagnose from, and
              // the run directory is created empty. Keep the CLI's own envelope: its
              // final text, turn count and stop reason are what separate "the model
              // never called Write" from "the endpoint refused the request".
              await writeFile(path.join(dir, `executor-attempt-${attempt}.json`), JSON.stringify(json, null, 2));

              // Zero usage across the board means the request never reached the API —
              // a quota or auth wall, not a failure of this run. Worth naming, because
              // it takes out whole arms at once and looks like a model failure. Retrying
              // one of those just walks into the same wall.
              const u = json.usage ?? {};
              const noUsage = !json.duration_api_ms && !(u.output_tokens ?? 0) && !json.total_cost_usd;
              if (noUsage) throw new Error(`no API call made (quota or auth wall), exit ${exitCode}`);
              if (attempt >= EXECUTOR_ATTEMPTS)
                throw new Error(`executor wrote no review in ${attempt} attempt(s), exit ${exitCode}`);
              console.log(
                `  [retry] ${label} — answered in ${json.num_turns} turns but wrote no review; retrying`
              );
            }
            if (exitCode !== 0) console.log(`  [note] ${label} exited ${exitCode} but wrote a review; keeping it`);

            const g =
              useAgentGrader
                ? finishGrade(c, lowApplies, (await gradeWithAgent(c, reviewPath, fixtureAbs, args.graderModel)) as any)
                : grade(c, review, lowApplies);
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
  const report = summarise(suite, results, args.model);
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
async function gradeExisting(
  cases: Case[],
  dir: string,
  arms: { treatment: Arm; baseline: Arm },
  opts: { agent: boolean; stored: boolean; skillDir: string; model: string; lowApplies: boolean }
): Promise<RunResult[]> {
  const { glob } = await import('node:fs/promises');
  const out: RunResult[] = [];
  for await (const entry of glob('**/review.md', { cwd: dir })) {
    const rel = String(entry);
    const c = cases.find((x) => rel.includes(x.id));
    // Baseline first: 'without_skill' contains 'with_skill' as a substring.
    const arm: Arm | undefined = rel.includes(arms.baseline)
      ? arms.baseline
      : rel.includes(arms.treatment)
        ? arms.treatment
        : undefined;
    if (!c || !arm) continue;
    const run = Number(/run-(\d+)/.exec(rel)?.[1] ?? 1);
    const reviewAbs = path.join(dir, rel);
    if (opts.stored) {
      // grading.json sits beside the review in the runner's layout, and one level up
      // in the older workspaces where reviews live in an outputs/ subdirectory.
      const candidates = [
        path.join(path.dirname(reviewAbs), 'grading.json'),
        path.join(path.dirname(path.dirname(reviewAbs)), 'grading.json'),
      ];
      let storedRaw: string | null = null;
      for (const cand of candidates) {
        storedRaw = await readFile(cand, 'utf8').catch(() => null);
        if (storedRaw) break;
      }
      if (!storedRaw) {
        console.log(`  [skip] ${c.id} ${arm} run-${run} — no stored grading.json`);
        continue;
      }
      const stored = JSON.parse(storedRaw);
      const raw = stored.grade ?? stored;
      const g2 = finishGrade(c, opts.lowApplies, {
        plantsFound: raw.plantsFound ?? [],
        plantsMissed: raw.plantsMissed ?? [],
        findings: raw.findings ?? 0,
        lowOrInfoInFindings: raw.lowOrInfoInFindings ?? 0,
        decoysNamedInFindings: raw.decoysNamedInFindings ?? [],
        falseClaims: raw.falseClaims ?? [],
      });
      out.push({ caseId: c.id, arm, run, ok: true, grade: g2, tokens: 0, costUsd: 0, durationMs: 0 });
      console.log(`  [${g2.passed}/${g2.total}] ${c.id} ${arm} run-${run} — re-scored from stored judgements`);
      continue;
    }
    const g = opts.agent
      ? finishGrade(c, opts.lowApplies, (await gradeWithAgent(c, reviewAbs, path.join(opts.skillDir, c.files[0]), opts.model)) as any)
      : grade(c, await readFile(reviewAbs, 'utf8'), opts.lowApplies);
    // Persist, so an agent judgement can be re-scored later without paying for it
    // again — and so a rubric change never silently re-reads a stale regex verdict.
    const res: RunResult = { caseId: c.id, arm, run, ok: true, grade: g, tokens: 0, costUsd: 0, durationMs: 0 };
    await writeFile(path.join(path.dirname(reviewAbs), 'grading.json'), JSON.stringify(res, null, 2));
    out.push(res);
    console.log(
      `  [${g.passed}/${g.total}] ${c.id} ${arm} run-${run} — ${g.findings} findings, ${g.lowOrInfoInFindings} LOW/Info` +
        (g.plantsMissed.length ? `, MISSED ${g.plantsMissed.join('+')}` : '')
    );
  }
  return out;
}

function summarise(suite: Suite, results: RunResult[], model = '') {
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
      categoryRecall: (() => {
        const acc: Record<string, [number, number]> = {};
        for (const r of rs)
          for (const [cat, [f2, t]] of Object.entries(r.grade!.categoryRecall)) {
            const [af, at] = acc[cat] ?? [0, 0];
            acc[cat] = [af + f2, at + t];
          }
        return Object.fromEntries(
          Object.entries(acc).map(([cat, [f2, t]]) => [cat, t ? f2 / t : 0])
        ) as Record<string, number>;
      })(),
      tokensMean: mean(rs.map((r) => r.tokens)),
      costUsd: rs.reduce((s, r) => s + r.costUsd, 0),
      durationMean: mean(rs.map((r) => r.durationMs)),
    };
  };

  const arms = armsFor(suite);
  const withSkill = stats(arms.treatment);
  const without = stats(arms.baseline);
  const g = suite.gates;
  const failures: string[] = [];
  const errored = results.filter((r) => !r.ok);
  if (errored.length) failures.push(`${errored.length} run(s) errored`);

  if (g.withSkillRecall !== undefined && withSkill.recall < g.withSkillRecall)
    failures.push(`${arms.treatment} recall ${withSkill.recall.toFixed(2)} < ${g.withSkillRecall}`);
  if (g.withSkillLowDiscipline !== undefined && withSkill.lowDiscipline < g.withSkillLowDiscipline)
    failures.push(
      `${arms.treatment} LOW discipline ${withSkill.lowDiscipline.toFixed(4)} < ${g.withSkillLowDiscipline}` +
        ` (${Math.round(withSkill.lowDiscipline * withSkill.runs)}/${withSkill.runs} runs)`
    );

  const delta = withSkill.passRate - without.passRate;
  if (g.minPassRateDelta !== undefined && delta < g.minPassRateDelta)
    failures.push(
      `pass-rate delta ${delta.toFixed(4)} < ${g.minPassRateDelta} — the skill is not earning its keep`
    );

  for (const [cat, want] of Object.entries(g.newSkillCategoryRecall ?? {})) {
    const got = withSkill.categoryRecall[cat] ?? 0;
    if (got < want) failures.push(`${arms.treatment} recall on '${cat}' plants ${got.toFixed(4)} < ${want}`);
  }
  // The delta the experiment exists to measure: the new rules must find what the old
  // version could not.
  for (const [cat, want] of Object.entries(g.minCategoryRecallDelta ?? {})) {
    const d = (withSkill.categoryRecall[cat] ?? 0) - (without.categoryRecall[cat] ?? 0);
    if (d < want)
      failures.push(`'${cat}' recall delta ${d.toFixed(4)} < ${want} — the new section is not earning its keep`);
  }
  // And the control must stay a control: a category both versions cover should not move.
  for (const [cat, limit] of Object.entries(g.maxCategoryRecallDelta ?? {})) {
    const d = Math.abs((withSkill.categoryRecall[cat] ?? 0) - (without.categoryRecall[cat] ?? 0));
    if (d > limit)
      failures.push(`'${cat}' is a control but the arms differ by ${d.toFixed(2)} > ${limit} — something other than the delta moved`);
  }

  return { skill: suite.skill_name, model, arms, withSkill, without, delta, gateFailures: failures, results, patternEchoes: [] as unknown[] };
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
    `| Metric | ${r.arms.treatment} | ${r.arms.baseline} | Delta |`,
    '|---|---|---|---|',
    `| Pass rate | ${pct(w.passRate)} | ${pct(b.passRate)} | ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)} |`,
    `| Recall (all plants found) | ${pct(w.recall)} | ${pct(b.recall)} | |`,
    `| LOW discipline | ${pct(w.lowDiscipline)} | ${pct(b.lowDiscipline)} | |`,
    `| Findings per review | ${w.findingsMean.toFixed(1)} ± ${w.findingsSd.toFixed(1)} | ${b.findingsMean.toFixed(1)} ± ${b.findingsSd.toFixed(1)} | |`,
    `| Signal density | ${pct(w.findingsTotal ? (w.runs * 3) / w.findingsTotal : 0)} | ${pct(b.findingsTotal ? (b.runs * 3) / b.findingsTotal : 0)} | |`,
    `| Tokens per run | ${Math.round(w.tokensMean).toLocaleString()} | ${Math.round(b.tokensMean).toLocaleString()} | |`,
    `| Wall clock per run | ${(w.durationMean / 1000).toFixed(0)}s | ${(b.durationMean / 1000).toFixed(0)}s | |`,
    // The CLI prices a run from its own model table. For a model id it does not
    // recognise — every OpenRouter id, which all contain a slash — it falls back to
    // Claude rates and overstates a DeepSeek run several-fold. Reporting that number
    // unlabelled would quietly turn the cheap arm into the expensive one.
    `| Cost | $${w.costUsd.toFixed(2)} | $${b.costUsd.toFixed(2)} | ${
      r.model.includes('/') ? '**estimate is unreliable off-Anthropic**' : ''
    } |`,
    ...(Object.keys(w.categoryRecall).length
      ? [
          '',
          '### Recall by plant category',
          '',
          `| Category | ${r.arms.treatment} | ${r.arms.baseline} | Delta |`,
          '|---|---|---|---|',
          ...Object.keys({ ...w.categoryRecall, ...b.categoryRecall }).map((cat) => {
            const wc = w.categoryRecall[cat] ?? 0;
            const bc = b.categoryRecall[cat] ?? 0;
            const d = wc - bc;
            return `| ${cat} | ${pct(wc)} | ${pct(bc)} | ${d >= 0 ? '+' : ''}${d.toFixed(2)} |`;
          }),
        ]
      : []),
    '',
    r.gateFailures.length ? `**Gates failed:** ${r.gateFailures.join('; ')}` : '**All gates passed.**',
  ].join('\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
