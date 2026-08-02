import { z } from 'zod';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../../platform/feature-models.js';
import { ConventionRepository, toConventionDto, type InsertConvention } from './repository.js';
import { CONFIG_CANDIDATES, collectSamples, renderSamples } from './sampler.js';
import { CONVENTIONS_SYSTEM_PROMPT, buildConventionsUserPrompt } from './prompt.js';
import { verifyAll, type RawCandidate } from './verify.js';
import { dedupeCandidates } from './dedupe.js';
import { CONVENTION_SAMPLE_FILES, MIN_CONFIDENCE } from './constants.js';
import type { ConventionExtractResult, ConventionStatus } from '@devdigest/shared';

/**
 * L02 — conventions extraction.
 *
 * Four stages, only ONE of which calls a model:
 *   1. sample selection  — pure code (configs + top-ranked files)
 *   2. model call        — cheap model, structured output
 *   3. evidence gate     — pure code, rejects unproven candidates
 *   4. persist           — replaces the repo's previous candidates
 *
 * The stage-3 counts are returned to the caller: `dropped` is the honest quality
 * signal for a run, and hiding it would make a bad extraction look like a good one.
 */

/** What the model must return. A wire shape, not a domain type — kept local. */
const ModelCandidate = z.object({
  category: z.string().nullish(),
  rule: z.string().min(1),
  evidence_path: z.string().min(1),
  evidence_snippet: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});
const ModelResponse = z.object({ candidates: z.array(ModelCandidate) });

export class ConventionsService {
  private repo: ConventionRepository;

  constructor(private container: Container) {
    this.repo = new ConventionRepository(container.db);
  }

  async list(workspaceId: string, repoId: string) {
    return (await this.repo.listForRepo(workspaceId, repoId)).map(toConventionDto);
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionExtractResult> {
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const ref = { owner: repoRow.owner, name: repoRow.name };

    // A missing file must not abort the run: a repo legitimately lacks most of
    // the config candidates, and one unreadable source file is not fatal.
    const readFile = async (path: string): Promise<string | undefined> => {
      try {
        return await this.container.git.readFile(ref, path);
      } catch {
        return undefined;
      }
    };

    // ---- 1. samples (no model) ---------------------------------------------
    let sourcePaths: string[] = [];
    try {
      sourcePaths = await this.container.repoIntel.getConventionSamples(
        repoId,
        CONVENTION_SAMPLE_FILES,
      );
    } catch {
      // repo-intel off or unindexed — configs alone still produce a useful run.
      sourcePaths = [];
    }

    const samples = await collectSamples(CONFIG_CANDIDATES, sourcePaths, readFile);
    if (samples.length === 0) {
      throw new ValidationError(
        'No readable samples for this repo. Check that it is cloned, then re-index it.',
      );
    }

    // ---- 2. model ----------------------------------------------------------
    const choice = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(choice.provider);

    const result = await llm.completeStructured({
      model: choice.model,
      schema: ModelResponse,
      schemaName: 'ConventionCandidates',
      temperature: 0,
      messages: [
        { role: 'system', content: CONVENTIONS_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildConventionsUserPrompt(repoRow.fullName, renderSamples(samples)),
        },
      ],
    });

    const proposed = result.data.candidates;
    const aboveFloor = proposed.filter((c) => c.confidence >= MIN_CONFIDENCE);

    // ---- 3. evidence gate (no model) ---------------------------------------
    const { verified } = await verifyAll(aboveFloor as RawCandidate[], readFile);

    // Models restate one rule once per file they saw it in — the first real run
    // produced 13 candidates covering 5 distinct rules. Collapsing them keeps the
    // extra sites as supporting evidence instead of extra cards to judge.
    const deduped = dedupeCandidates(verified);

    // ---- 4. persist --------------------------------------------------------
    const rows: InsertConvention[] = deduped.map((c) => ({
      workspaceId,
      repoId,
      category: c.category ?? null,
      // Extra sites are appended to the rule so they survive into the skill body
      // — more places a rule holds is a reason to trust it.
      rule:
        c.also_seen_in.length > 0
          ? `${c.rule} (also seen in ${c.also_seen_in.join(', ')})`
          : c.rule,
      evidencePath: c.evidence_path,
      evidenceSnippet: c.evidence_snippet,
      startLine: c.start_line,
      endLine: c.end_line,
      confidence: c.confidence,
    }));
    const saved = await this.repo.replaceForRepo(workspaceId, repoId, rows);

    return {
      proposed: proposed.length,
      verified: deduped.length,
      // Only unproven candidates. Duplicates collapsed by dedupe are reported
      // separately — calling a merged duplicate "dropped for bad evidence" would
      // misrepresent the extractor's accuracy in both directions.
      dropped: proposed.length - verified.length,
      merged: verified.length - deduped.length,
      candidates: saved.map(toConventionDto),
    };
  }

  async setStatus(workspaceId: string, id: string, status: ConventionStatus) {
    const row = await this.repo.setStatus(workspaceId, id, status);
    if (!row) throw new NotFoundError('Convention not found');
    return toConventionDto(row);
  }

  async edit(workspaceId: string, id: string, patch: { rule?: string; category?: string | null }) {
    const row = await this.repo.editRule(workspaceId, id, patch);
    if (!row) throw new NotFoundError('Convention not found');
    return toConventionDto(row);
  }

  /** Accepted candidates only — read from the DB, never from the request body. */
  async acceptedFor(workspaceId: string, repoId: string) {
    return (await this.repo.listAccepted(workspaceId, repoId)).map(toConventionDto);
  }
}
