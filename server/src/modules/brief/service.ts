/**
 * L05 — the PR Why + Risk Brief service: the read path and the assemble path.
 *
 * ── THE TWO PATHS, AND WHY THEY ARE DIFFERENT SHAPES ──────────────────────
 *
 * **`get` is model-free and outbound-free (REQ-9).** It reads the stored brief
 * and recomputes only the LOCAL half of the fingerprint (D-1a) — eight
 * components that all come from our own database and settings. It never calls a
 * model, never calls GitHub, never reads the clone, and never starts an
 * assembly. That is what lets the Overview tab hold it open on every PR open
 * inside §7's 300 ms budget. A PR with no stored brief is `null`: an explicit
 * no-brief OUTCOME, not a 404, because "you have not generated one yet" is a
 * normal state of a working feature and the card renders an empty state for it.
 *
 * **`assemble` spends money, so it refuses early and loudly.** It costs exactly
 * one structured completion and it is the only place that pays for the remote
 * half of the fingerprint (a GitHub read and a set of clone reads). Everything
 * that can make the answer worthless is checked BEFORE the call: no changed
 * files, and no intent alongside a degraded map, are both 422s naming what is
 * missing rather than a confident brief built from nothing.
 *
 * ── TENANCY ───────────────────────────────────────────────────────────────
 *
 * `pr_brief` has NO `workspace_id`; it scopes transitively through `pr_id`.
 * Both entry points therefore call `reviewRepo.getPull(workspaceId, prId)`
 * BEFORE any `pr_brief` access — including on the read path, where a cache HIT
 * that skipped the check would serve another tenant's brief while a MISS
 * correctly 404'd, making the guard depend on whether a row happened to exist.
 * That exact bug is recorded for `pr_intent` in `server/INSIGHTS.md` and
 * guarded at `intent/service.ts:69-75`; this mirrors it.
 *
 * ── WHAT THIS FILE DELIBERATELY DOES NOT DO ───────────────────────────────
 *
 *  - **It never derives intent.** `container.intent(log).get` reads; the sibling
 *    `getOrCompute` would derive on a miss and make the feature cost TWO model
 *    calls where the spec allows one (D-12). A stale intent is read AS IS and
 *    the fingerprint records which derivation it was, so the staleness is
 *    visible rather than silently repaired at the user's expense.
 *  - **It never reads `NODE_ENV`.** REQ-9's "no model call on the read path" is
 *    a property of the code, not of the environment — an assertion that only
 *    holds under a test config is not an assertion about the product.
 *  - **It never recomputes cost.** `tokensIn`/`tokensOut`/`costUsd` are read
 *    from the provider result, the house rule everywhere else in this server.
 */
import type { GitHubClient } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  ExternalServiceError,
  NotFoundError,
  ValidationError,
} from '../../platform/errors.js';
import { resolveFeatureModel } from '../../platform/feature-models.js';
import type { PullRow } from '../reviews/repository.js';
import type { BlastResponse } from '../blast/contract.js';
import {
  parseReferences,
  resolveReferences,
  type ResolvedReference,
  type SkippedReference,
} from '../intent/references.js';
import { assembleBriefInput, type BriefChangedFile } from './assemble.js';
import {
  ASSEMBLER_VERSION,
  MAX_OUTPUT_TOKENS,
  TIMEOUT_MS,
} from './constants.js';
import {
  BriefDocument,
  BriefFingerprint,
  BriefProvenance,
  ModelBrief,
  type BriefBlastState,
  type BriefResponse,
  type MovedInput,
} from './contract.js';
import {
  computeFingerprint,
  describeMoved,
  localComponents,
  parseStoredFingerprint,
  serializeFingerprint,
  type FingerprintInput,
  type LocalComponents,
} from './fingerprint.js';
import { buildAllowList, filterReferences } from './grounding.js';
import { buildProvenance } from './provenance.js';
import { BriefRepository, type StoredBriefRow } from './repository.js';

/** Pino-style logger, as passed around the request path (`req.log`). */
export type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
};

/**
 * The name the structured call is registered under.
 *
 * Distinct from `PrIntent` on purpose: the mock provider keys its fixtures by
 * `schemaName`, and two features sharing one name would make an intent fixture
 * answer a brief request in every integration suite.
 */
const SCHEMA_NAME = 'PrBrief';

/**
 * Everything both paths need about the PR's current state, gathered from our own
 * database and settings. No network, no model — the read path runs exactly this
 * much and stops.
 */
interface LocalState {
  pull: PullRow;
  /** The stored intent, read and never derived. */
  intent: { derived_at: string | null; model: string | null } | null;
  /** The blast envelope, or null when it could not be built at all. */
  blast: BlastResponse | null;
  /** `blast` is absent or explicitly `degraded` — REQ-11's second condition. */
  blastDegraded: boolean;
  model: { provider: string; model: string };
  components: LocalComponents;
}

export class BriefService {
  private readonly repo: BriefRepository;

  constructor(
    private readonly container: Container,
    private readonly logger?: Logger,
  ) {
    this.repo = new BriefRepository(container.db);
  }

  private get reviewRepo() {
    return this.container.reviewRepo;
  }

  // ─────────────────────────────────────────────────────────── read path ──

  /**
   * The stored brief, or `null` when none is stored.
   *
   * Model-free and outbound-free. The only work beyond the two row reads is
   * recomputing the eight local fingerprint components — which needs the blast
   * envelope, itself an index read with no LLM on its path by construction
   * (`blast/service.ts`).
   */
  async get(workspaceId: string, prId: string): Promise<BriefResponse | null> {
    const state = await this.localState(workspaceId, prId);
    const row = await this.repo.getBrief(prId);
    if (!row) return null;
    return this.toResponse(row, state.components);
  }

  // ─────────────────────────────────────────────────────── assemble path ──

  /**
   * Assemble a brief: at most ONE structured completion, and none at all when
   * every input is unchanged and the caller did not ask to regenerate.
   */
  async assemble(
    workspaceId: string,
    prId: string,
    opts: { regenerate?: boolean } = {},
  ): Promise<BriefResponse> {
    const state = await this.localState(workspaceId, prId);
    const { pull } = state;

    // REQ-11 / cardinality zero: no diff, nothing to be a brief OF. The stored
    // patches arrive with `GET /pulls/:id`, not with a poll — the empty-diff
    // failure mode recorded in `server/INSIGHTS.md` is exactly this, and it is
    // worth a message that says how to fix it.
    const files = await this.reviewRepo.getPrFiles(prId);
    if (files.length === 0) {
      throw new ValidationError(
        'This pull request has no changed files stored, so there is nothing to brief. Open the pull request once (GET /pulls/:id) to fetch its diff, then try again.',
      );
    }

    // REQ-11: intent and the blast map are the two substantive inputs. Losing
    // ONE narrows the brief; losing BOTH leaves paths and counts, and a risk
    // assessment built from that is a guess wearing a card.
    if (!state.intent && state.blastDegraded) {
      throw new ValidationError(
        'Cannot assemble a brief: no intent has been derived for this pull request (POST /pulls/:id/intent), and the blast dependency map is degraded' +
          `${state.blast?.reason ? ` (${state.blast.reason})` : ''}` +
          ' (POST /repos/:id/resync). Both of the two substantive inputs are missing.',
      );
    }

    // ---- The remote half: resolved best-effort, never fatal ---------------
    const { issue, documents, skipped } = await this.resolveInputs(pull);

    const fingerprint = computeFingerprint(
      this.fingerprintInput(state, issue, documents),
    );

    // AC-18: every input unchanged and no explicit regenerate → the stored
    // brief, and NOT a second model call. The comparison is over all ten
    // components, which is why it lives here and not on the read path.
    const stored = await this.repo.getBrief(prId);
    if (!opts.regenerate && stored) {
      const parsed = parseStoredFingerprint(stored.stateFingerprint);
      if (
        parsed &&
        parsed.local === fingerprint.local &&
        parsed.remote === fingerprint.remote
      ) {
        return this.toResponse(stored, state.components);
      }
    }

    // ---- Assemble, measure, and make the one call -------------------------
    // What the model was actually given, in the vocabulary the record stores:
    // the assembler is handed `null` both for a degraded map and for no map at
    // all, so `degraded` covers both here for the same reason.
    const blastState: BriefBlastState =
      state.blast && !state.blastDegraded ? state.blast.state : 'degraded';

    const assembly = assembleBriefInput({
      intent: state.intent ? await this.intentDocument(workspaceId, prId) : null,
      // A degraded map contributes nothing and must NOT be recorded as an input
      // that contributed — `blast/contract.ts` is explicit that a degraded state
      // means UNKNOWN impact and may never be rendered as an empty map.
      blast: state.blastDegraded ? null : state.blast,
      stats: {
        additions: pull.additions ?? 0,
        deletions: pull.deletions ?? 0,
        files_count: pull.filesCount ?? files.length,
      },
      files: files.map(
        (f): BriefChangedFile => ({
          path: f.path,
          additions: f.additions ?? 0,
          deletions: f.deletions ?? 0,
          patch: f.patch,
        }),
      ),
      issue,
      references: documents,
      countTokens: (text) => this.container.tokenizer.count(text),
    });

    const llm = await this.container.llm(
      state.model.provider as 'openai' | 'anthropic' | 'openrouter',
    );

    let result;
    try {
      result = await llm.completeStructured({
        model: state.model.model,
        schema: ModelBrief,
        schemaName: SCHEMA_NAME,
        temperature: 0.2,
        maxTokens: MAX_OUTPUT_TOKENS,
        timeoutMs: TIMEOUT_MS,
        messages: [
          { role: 'system', content: assembly.system },
          { role: 'user', content: assembly.user },
        ],
      });
    } catch (err) {
      // The stored brief is NOT replaced. A failed regeneration must leave the
      // reader with the brief they had, not with an empty card — 502 says the
      // upstream failed, and the previous answer is still readable via GET.
      this.logger?.warn(
        { prId, err: (err as Error).message },
        'brief: model call failed; the stored brief is unchanged',
      );
      throw new ExternalServiceError(
        `The brief could not be generated: ${(err as Error).message}`,
      );
    }

    // ---- REQ-6 grounding, then REQ-7's lower-only cap ---------------------
    // The allow-list is built from the files that actually REACHED the model:
    // a file dropped by the budget was never observed by it, and allowing a
    // reference to it would ground a claim in something the model never saw.
    // Passed as files rather than as paths so the hunk ranges a
    // `review_focus[].line` is checked against are read from the very patches
    // the assembler rendered `@@` headers from — a separately-derived list
    // could disagree with what the model was shown.
    const listed = files
      .slice(0, assembly.files_listed)
      .map((f) => ({ path: f.path, patch: f.patch }));
    const grounded = filterReferences(
      result.data,
      buildAllowList(listed, state.blastDegraded ? null : state.blast),
    );

    const provenance = buildProvenance({
      assembly,
      blast_state: blastState,
      references_skipped: skipped,
      discarded_refs: grounded.discarded,
      result: {
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd,
      },
    });

    const generatedAt = new Date();
    await this.repo.upsertBrief(prId, {
      document: grounded.document,
      // Serialised, not the bare pair: the column also carries the local
      // component RECORD, which is the only thing that can name WHICH input
      // moved (REQ-14). Two digests can say "something did".
      fingerprint: serializeFingerprint(fingerprint, state.components),
      provenance,
      model: result.model,
      costUsd: result.costUsd,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      generatedAt,
    });

    this.logger?.info(
      {
        prId,
        model: result.model,
        estimatedInputTokens: assembly.estimated_input_tokens,
        // REQ-4a: an over-budget call is a fact worth finding by grep, not only
        // by reading a stored row back. A boolean, so no input content.
        dropOrderExhausted: assembly.drop_order_exhausted,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        discardedRefs: grounded.discarded,
        inputs: provenance.inputs_used,
      },
      'brief: assembled',
    );

    return {
      ...grounded.document,
      state_fingerprint: fingerprint,
      inputs_used: provenance.inputs_used,
      references_used: provenance.references_used,
      references_skipped: provenance.references_skipped,
      discarded_refs: provenance.discarded_refs,
      // Read back off the record that was just stored, so the assemble response
      // and the next read of the same row cannot describe the input differently.
      blast_state: provenance.blast_state ?? null,
      changed_files: provenance.changed_files ?? null,
      model: result.model,
      cost_usd: result.costUsd,
      tokens_in: result.tokensIn,
      tokens_out: result.tokensOut,
      generated_at: generatedAt.toISOString(),
      // Just written from exactly these components; nothing can have moved yet.
      out_of_date: false,
      moved_inputs: [],
    };
  }

  // ──────────────────────────────────────────────────────────── internals ──

  /**
   * Ownership check, then everything the local fingerprint half is made of.
   *
   * Ordered deliberately: `getPull(workspaceId, …)` is the FIRST thing either
   * path does, so no `pr_brief` row is ever read for a PR the caller does not
   * own.
   */
  private async localState(workspaceId: string, prId: string): Promise<LocalState> {
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    // READ, never derive (D-12). `get` throws for an unowned PR too, so the
    // guard above is belt-and-braces rather than the only check.
    const record = await this.container.intent(this.logger).get(workspaceId, prId);
    const intent = record
      ? { derived_at: record.derived_at ?? null, model: record.model ?? null }
      : null;

    // Best-effort, exactly like every other context enrichment in this server:
    // on error we omit the section rather than failing the request.
    let blast: BlastResponse | null = null;
    try {
      blast = await this.container.blast.forPull(workspaceId, prId);
    } catch (err) {
      this.logger?.warn(
        { prId, err: (err as Error).message },
        'brief: blast map unavailable; treating it as degraded',
      );
    }
    const blastDegraded = blast === null || blast.state === 'degraded';

    const model = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    return {
      pull,
      intent,
      blast,
      blastDegraded,
      model,
      components: localComponents({
        headSha: pull.headSha,
        intent,
        blast,
        model,
        assemblerVersion: ASSEMBLER_VERSION,
        // Unused by `localComponents` — the local half is local by definition.
        issue: null,
        documents: [],
      }),
    };
  }

  /** The full ten-component input, once the remote half has been resolved. */
  private fingerprintInput(
    state: LocalState,
    issue: { number: number; title: string; body?: string | null; state?: string | null } | null,
    documents: readonly ResolvedReference[],
  ): FingerprintInput {
    return {
      headSha: state.pull.headSha,
      intent: state.intent,
      blast: state.blast,
      model: state.model,
      assemblerVersion: ASSEMBLER_VERSION,
      issue,
      documents: documents.map((d) => ({ source: d.source, content: d.content })),
    };
  }

  /** The stored intent document itself, for the assembler. Never derived. */
  private async intentDocument(workspaceId: string, prId: string) {
    const record = await this.container.intent(this.logger).get(workspaceId, prId);
    if (!record) return null;
    return {
      intent: record.intent,
      in_scope: record.in_scope,
      out_of_scope: record.out_of_scope,
      confidence: record.confidence,
      sources: record.sources,
    };
  }

  /**
   * Resolve what the PR body points at: the linked issue and the referenced
   * plan/spec documents.
   *
   * Best-effort in three separate ways, and each one matters:
   *  - GitHub is optional (no PAT ⇒ no issue, not a failure);
   *  - `container.webFetch` THROWS when `INTENT_EXTERNAL_FETCH_ENABLED` is at
   *    its default `false`, and the correct reading of that throw is "skip
   *    external references" — the skip is then recorded with its reason
   *    (AC-33), so a URL that was never fetched is visibly different from one
   *    that was fetched and came back empty;
   *  - `resolveReferences` already wraps each fetch individually, so one
   *    unreachable document can never take the others down with it.
   *
   * `dropWholeItems: true` is the one behavioural difference from intent's call
   * (BQ-2/A): a document cut mid-sentence can sever a "must not" from its
   * clause and invert it, and this consumer reasons over the document's MEANING
   * rather than sampling it.
   */
  private async resolveInputs(pull: PullRow): Promise<{
    issue: { number: number; title: string; body: string; state: null } | null;
    documents: ResolvedReference[];
    skipped: SkippedReference[];
  }> {
    const repoRow = await this.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    const repoRef = { owner: repoRow.owner, name: repoRow.name };

    let github: GitHubClient | null = null;
    try {
      github = await this.container.github();
    } catch {
      github = null;
    }

    let webFetch = null;
    try {
      webFetch = this.container.webFetch;
    } catch {
      webFetch = null;
    }

    const log = this.logger
      ? { info: (msg: string, data?: unknown) => this.logger!.info(data ?? {}, msg) }
      : undefined;

    const refs = parseReferences(pull.body, repoRef);
    const { resolved, skipped } = await resolveReferences(refs, {
      repoRef,
      git: this.container.git,
      github,
      webFetch,
      dropWholeItems: true,
      log,
    });

    // The first same-repo `#N` doubles as the linked issue, so a ticket is not
    // counted twice — once as an issue and again as a reference document. Same
    // rule as `intent/service.ts`, and the same reason.
    const issueRef = refs.find(
      (r) => r.kind === 'github' && r.owner === repoRef.owner && r.repo === repoRef.name,
    );
    // Matched on the WHOLE source (`owner/repo#N`), never on the `#N` suffix.
    // `fetchOne` builds that source at `intent/references.ts:288`, and
    // `parseReferences` emits GitHub-URL refs BEFORE short `#N` refs — so a body
    // reading "Closes #123. Upstream: https://github.com/other/repo/issues/123"
    // puts `other/repo#123` first in `resolved`, and a suffix test picks the
    // foreign repo's title and body for a `## Linked issue #123` block that
    // claims to be ours. It also digests the wrong text into the `linked_issue`
    // fingerprint component, so editing the real issue stops moving it.
    const issueSource = issueRef?.issueNumber
      ? `${repoRef.owner}/${repoRef.name}#${issueRef.issueNumber}`
      : null;
    const issueContent = issueSource
      ? resolved.find((r) => r.kind === 'github' && r.source === issueSource)
      : undefined;
    const issue =
      issueRef?.issueNumber && issueContent
        ? {
            number: issueRef.issueNumber,
            title: issueContent.content.split('\n')[0] ?? '',
            body: issueContent.content.split('\n').slice(1).join('\n'),
            // The resolver returns title+body, not the issue's open/closed
            // state. Left null rather than guessed: the fingerprint digests the
            // TEXT, so an edited issue still moves the remote half without it.
            state: null,
          }
        : null;

    return {
      issue,
      documents: resolved.filter((r) => r !== issueContent),
      skipped,
    };
  }

  /**
   * A stored row as the HTTP envelope, with REQ-14's freshness marker computed
   * against the components we just recomputed.
   */
  private toResponse(row: StoredBriefRow, current: LocalComponents): BriefResponse {
    // Written by us, so a parse failure here is a real defect and surfaces as a
    // 500 rather than being papered over with a half-rendered card.
    const document = BriefDocument.parse(row.json);

    const stored = parseStoredFingerprint(row.stateFingerprint);
    let out_of_date: boolean;
    let moved_inputs: MovedInput[];
    if (stored) {
      moved_inputs = describeMoved(stored.local_components, current);
      out_of_date = moved_inputs.length > 0;
    } else {
      // A pre-feature or corrupt fingerprint cannot PROVE freshness, so the
      // brief is marked out of date. It names nothing: with no stored
      // components there is no honest way to say which input moved.
      moved_inputs = [];
      out_of_date = true;
    }

    // `BriefFingerprint.parse` strips `local_components`, so the envelope keeps
    // exactly the two digests the contract declares.
    const state_fingerprint = stored
      ? BriefFingerprint.parse(stored)
      : { local: '', remote: '' };

    // A provenance that is null (the column is nullable, and a row written
    // before the feature has one) or whose shape has drifted is UNKNOWN, not
    // empty. Serving `inputs_used: []` for it told the card "no source
    // contributed", which it then read as "this repository is not indexed" over
    // a brief assembled from a healthy map (F-7). `null` says what is true: we
    // cannot tell what this brief used.
    const provenance = BriefProvenance.safeParse(row.provenance);
    const p = provenance.success ? provenance.data : null;

    return {
      ...document,
      state_fingerprint,
      inputs_used: p ? p.inputs_used : null,
      // The three list-shaped fields stay empty rather than nullable: §10 says
      // a consumer must show nothing for them and must not read absence as
      // "nothing was skipped", and `inputs_used === null` is the marker that
      // says which of the two an empty list is.
      references_used: p?.references_used ?? [],
      references_skipped: p?.references_skipped ?? [],
      discarded_refs: p?.discarded_refs ?? 0,
      // Absent on a row stored before these were recorded, and on an unreadable
      // one. Both are "not recorded" — never `degraded`, and never `ok`.
      blast_state: p?.blast_state ?? null,
      changed_files: p?.changed_files ?? null,
      model: row.model,
      cost_usd: row.costUsd,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      // The epoch for a row that predates the column: an obviously ancient date
      // beside `out_of_date: true` reads honestly, where an empty string would
      // reach the card as an Invalid Date.
      generated_at: (row.generatedAt ?? new Date(0)).toISOString(),
      out_of_date,
      moved_inputs,
    };
  }
}
