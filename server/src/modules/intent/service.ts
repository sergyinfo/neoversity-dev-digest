import type { GitHubClient, PrIntentRecord } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../../platform/feature-models.js';
// Cross-module import, deliberately: `pr_files`/`pr_intent` are owned by
// ReviewRepository, which the container hands out precisely so other modules use
// the review domain without reaching into it. `loadDiff` is a thin function over
// that same repository plus `container.git`, and a second copy of it would be
// free to drift — the silent empty-diff failure in server/INSIGHTS.md is exactly
// what a drifted copy looks like.
import { loadDiff } from '../reviews/diff-loader.js';
import type { PullRow, StoredIntent } from '../reviews/repository.js';
import { classifyIntent } from './classifier.js';
import { parseReferences, resolveReferences } from './references.js';
import { MAX_COMMIT_SUBJECTS } from './constants.js';

/**
 * Derives, stores and serves a PR's intent.
 *
 * Cheap by construction: `getOrCompute` only calls the model when there is no
 * stored intent, or when the PR head has moved since the stored one was derived.
 * Every enrichment (linked issue, referenced plans) is best-effort — the intent
 * must remain derivable from title + branch + commits + paths alone.
 */
/** Pino-style logger, as passed around the review path (`req.log`). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

export class IntentService {
  /** Message-first shim: the classifier and resolver log prose, pino wants (obj, msg). */
  private readonly log?: { info: (msg: string, data?: unknown) => void };

  constructor(
    private container: Container,
    logger?: Logger,
  ) {
    this.log = logger
      ? { info: (msg, data) => logger.info(data ?? {}, msg) }
      : undefined;
  }

  private get repo() {
    return this.container.reviewRepo;
  }

  /** Stored intent for a PR, or undefined. Never calls a model. */
  async get(workspaceId: string, prId: string): Promise<PrIntentRecord | undefined> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    const stored = await this.repo.getIntent(prId);
    return stored ? toRecord(prId, stored) : undefined;
  }

  /**
   * Stored intent if it is fresh, otherwise derive and store one.
   *
   * `headSha` is passed in rather than read from the row because the PR-detail
   * route refreshes the head from GitHub WITHOUT writing it back to
   * `pull_requests` — comparing against the stored column would mean the cache
   * never invalidates.
   */
  async getOrCompute(
    workspaceId: string,
    prId: string,
    opts: { headSha?: string | null; force?: boolean } = {},
  ): Promise<PrIntentRecord> {
    // Ownership is verified BEFORE the cache is read, not only on the miss path.
    // `pr_intent` carries no workspace_id of its own — it scopes transitively via
    // pr_id, like pr_files/pr_commits/pr_brief — so a cache HIT that skipped this
    // would serve another tenant's intent while a MISS correctly 404'd through
    // `compute`. That made the guard depend on whether a row happened to be cached.
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const stored = opts.force ? undefined : await this.repo.getIntent(prId);
    const currentHead = opts.headSha ?? undefined;
    const isFresh =
      stored !== undefined &&
      (currentHead === undefined || stored.headSha === null || stored.headSha === currentHead);
    if (stored && isFresh) return toRecord(prId, stored);
    return this.computeFor(workspaceId, pull, currentHead);
  }

  /** Always calls the model. Used by the explicit recompute route. */
  async compute(
    workspaceId: string,
    prId: string,
    headSha?: string | null,
  ): Promise<PrIntentRecord> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');
    return this.computeFor(workspaceId, pull, headSha);
  }

  /**
   * The derivation itself. Takes an ALREADY-SCOPED `PullRow` rather than a bare
   * prId, so the tenancy check cannot be skipped by a future caller: the only way
   * to obtain one is `getPull(workspaceId, …)`. Both public entry points do that
   * lookup exactly once and hand the row down.
   */
  private async computeFor(
    workspaceId: string,
    pull: PullRow,
    headSha?: string | null,
  ): Promise<PrIntentRecord> {
    const log = this.log;
    const prId = pull.id;
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const repoRef = { owner: repoRow.owner, name: repoRow.name };

    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);

    // GitHub is optional: no PAT means no ticket enrichment, not a failure.
    let github: GitHubClient | null = null;
    try {
      github = await this.container.github();
    } catch {
      github = null;
    }

    // Same for external fetching — the container throws when the flag is off.
    let webFetch = null;
    try {
      webFetch = this.container.webFetch;
    } catch {
      webFetch = null;
    }

    const refs = parseReferences(pull.body, repoRef);
    const references = await resolveReferences(refs, {
      repoRef,
      git: this.container.git,
      github,
      webFetch,
      log,
    });

    // The first same-repo reference doubles as the "linked issue" signal, so a
    // ticket is not counted twice — once as an issue and again as a reference.
    const issueRef = refs.find(
      (r) => r.kind === 'github' && r.owner === repoRef.owner && r.repo === repoRef.name,
    );
    const issueContent = references.find(
      (r) => r.kind === 'github' && r.source.endsWith(`#${issueRef?.issueNumber}`),
    );
    const issue =
      issueRef?.issueNumber && issueContent
        ? {
            number: issueRef.issueNumber,
            title: issueContent.content.split('\n')[0] ?? '',
            body: issueContent.content.split('\n').slice(1).join('\n'),
          }
        : null;
    const nonIssueRefs = references.filter((r) => r !== issueContent);

    const commits = await this.repo.getPrCommits(prId);
    const commitSubjects = commits
      .slice(0, MAX_COMMIT_SUBJECTS)
      .map((c) => c.message)
      .filter((m): m is string => !!m && m.trim().length > 0);

    const choice = await resolveFeatureModel(this.container, workspaceId, 'review_intent');
    const llm = await this.container.llm(choice.provider);

    const result = await classifyIntent({
      title: pull.title,
      body: pull.body,
      branch: pull.branch,
      commitSubjects,
      issue,
      references: nonIssueRefs,
      diff,
      llm,
      model: choice.model,
      log,
    });

    const head = headSha ?? pull.headSha;
    await this.repo.upsertIntent(prId, result.intent, { headSha: head, model: choice.model });

    return {
      pr_id: prId,
      ...result.intent,
      head_sha: head,
      model: choice.model,
      derived_at: new Date().toISOString(),
    };
  }
}

function toRecord(prId: string, stored: StoredIntent): PrIntentRecord {
  return {
    pr_id: prId,
    intent: stored.intent,
    in_scope: stored.in_scope,
    out_of_scope: stored.out_of_scope,
    confidence: stored.confidence,
    sources: stored.sources,
    head_sha: stored.headSha ?? null,
    model: stored.model ?? null,
    derived_at: stored.derivedAt.toISOString(),
  };
}
