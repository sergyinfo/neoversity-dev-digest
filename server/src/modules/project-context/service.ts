import type { Container } from '../../platform/container.js';
import { AppError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { ProjectContextRepository, toAttachmentDto } from './repository.js';
import type { ResolvedAttachment } from './repository.js';
import {
  assembleProjectContext,
  specsReadFor,
  type AssembleResult,
  type ResolvedDoc,
} from './assemble.js';
import {
  discoverDocs,
  isDiscoverableDocPath,
  isSafeRelPath,
  readDoc,
  resolveCloneRoot,
} from './discovery.js';
import {
  MAX_ATTACHMENTS_PER_TARGET,
  MAX_DOC_BYTES,
  MAX_DOCS_PER_RESOLUTION,
  PROJECT_CONTEXT_TOKEN_BUDGET,
} from './constants.js';
import type {
  AttachmentInput,
  AttachmentRow,
  AttachmentTargetKind,
  ContextDocList,
  Projection,
} from './contract.js';

/**
 * L05 (S6) — Project Context orchestration.
 *
 * Owns the clone read for the whole server (§9): `reviews` calls this service
 * and never opens a document itself, the same shape as `getAgentSkillBodies`
 * living in `reviews`' own repository for the skills case.
 */

/** What a run needs, plus the record REQ-14 puts in the trace. */
export interface RunContext extends AssembleResult {
  /**
   * `RunTrace.specs_read` — EVERY attachment: injected ones as a bare path,
   * skipped and dropped ones as path + reason. The contract shape is unchanged
   * (`z.array(z.string())`), so a consumer that does not parse the reason still
   * renders a useful path, which is exactly what `TraceBody.tsx` does today.
   */
  specsRead: string[];
}

/**
 * What CONSUMING modules may reach through the container (fix-brief F6).
 *
 * Deliberately narrow: `run-executor` needs exactly one method, and a
 * container slot typed as the whole class would force a test stub to
 * reimplement the repository too — which is the injection seam the finding is
 * about. Same shape as `RepoIntel` (`repo-intel/types.ts`), for the same
 * reason. This module's own routes construct `ProjectContextService` directly,
 * which is a module using its own service, not a cross-module reach.
 */
export interface ProjectContext {
  resolveFor(
    workspaceId: string,
    agentId: string,
    repo: { id: string; clonePath: string | null },
  ): Promise<RunContext>;
}

export class ProjectContextService implements ProjectContext {
  private repo: ProjectContextRepository;

  constructor(private container: Container) {
    this.repo = new ProjectContextRepository(container.db);
  }

  // -------------------------------------------------------------- discovery

  /**
   * REQ-1 — read live from the clone on every request. There is no cache to
   * invalidate, which is why §6's Freshness row can promise the list always
   * matches the clone.
   */
  async listDocs(workspaceId: string, repoId: string): Promise<ContextDocList> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    // Cross-workspace is a 404, never a 403: a 403 confirms the row exists.
    if (!repo) throw new NotFoundError('Repo not found');

    const lastSyncedAt = repo.lastPolledAt?.toISOString() ?? null;

    const root = await resolveCloneRoot(repo.clonePath);
    if (!root.ok) {
      // AC-2 and its F3 sibling: an empty list CARRYING ITS REASON, not a 500
      // and not an error toast. `not_cloned` and `clone_missing` are different
      // facts and the client renders different copy for each.
      return { files: [], capped: false, reason: root.reason, last_synced_at: lastSyncedAt };
    }

    const { files, capped } = await discoverDocs(root.root, this.container.tokenizer);
    const usage = await this.repo.usageCounts(workspaceId, repoId);

    return {
      files: files.map((f) => ({
        ...f,
        // Absent rather than 0 when nothing uses it — §10 says the consumer
        // shows "—", and a 0 would read as a measured fact.
        ...(usage.byPath[f.path] !== undefined ? { used_by_count: usage.byPath[f.path] } : {}),
      })),
      capped,
      reason: null,
      last_synced_at: lastSyncedAt,
    };
  }

  /** REQ-9's per-skill count, for the Skills tab. */
  usageCounts(workspaceId: string, repoId: string) {
    return this.repo.usageCounts(workspaceId, repoId);
  }

  // ------------------------------------------------------------ attachments

  async listAttachments(
    workspaceId: string,
    kind: AttachmentTargetKind,
    targetId: string,
  ): Promise<AttachmentRow[]> {
    if (!(await this.repo.targetExists(workspaceId, kind, targetId))) {
      throw new NotFoundError(`${kind === 'agent' ? 'Agent' : 'Skill'} not found`);
    }
    const rows = await this.repo.listForTarget(workspaceId, kind, targetId);
    return rows.map(toAttachmentDto);
  }

  /**
   * Attach one document. Every refusal here is a refusal the UI can explain:
   * unsafe path (422), unknown repo/target (404), over the per-document cap
   * (422, AC-6), too many attachments (422), already attached (409).
   */
  async attach(workspaceId: string, input: AttachmentInput): Promise<AttachmentRow> {
    // AC-5 — the string gate, before anything is opened. The containment gate
    // in `readDoc` runs again at every read, because an attachment stores a
    // path and the clone moves under it (TOCTOU across a resync).
    if (!isSafeRelPath(input.path)) {
      throw new ValidationError('Invalid document path', { path: input.path });
    }
    // REQ-2's OTHER half (fix-brief F1): a path the walk would never list must
    // not be attachable. Without this, `.git/config` — which carries the PAT
    // that `withGitHubToken` embeds in the clone URL — is a valid attachment,
    // and the next run puts it in the prompt and in the persisted trace.
    // Refused here as well as at the read, so it never reaches the table at all.
    if (!isDiscoverableDocPath(input.path)) {
      throw new ValidationError(
        'That path is not a discoverable documentation file for this repository',
        { path: input.path },
      );
    }

    const repo = await this.repo.getRepo(workspaceId, input.repo_id);
    if (!repo) throw new NotFoundError('Repo not found');
    if (!(await this.repo.targetExists(workspaceId, input.target_kind, input.target_id))) {
      throw new NotFoundError(`${input.target_kind === 'agent' ? 'Agent' : 'Skill'} not found`);
    }

    const existing = await this.repo.listForTarget(
      workspaceId,
      input.target_kind,
      input.target_id,
    );
    // F1's partial unique indexes are the BACKSTOP, not the UX: a raw
    // 23505 surfacing as a 500 would be a correct database and a broken API.
    if (existing.some((r) => r.path === input.path && r.repoId === input.repo_id)) {
      throw new AppError(
        'already_attached',
        'That document is already attached to this target',
        409,
        { path: input.path },
      );
    }
    if (existing.length >= MAX_ATTACHMENTS_PER_TARGET) {
      throw new ValidationError(
        `At most ${MAX_ATTACHMENTS_PER_TARGET} documents can be attached to one ${input.target_kind}`,
      );
    }

    // AC-6 — over the 64 KB cap ⇒ listed, but not attachable. Checked against
    // the clone rather than a remembered listing, so the answer is current.
    const root = await resolveCloneRoot(repo.clonePath);
    if (root.ok) {
      const read = await readDoc(root.root, input.path);
      if (!read.ok && read.reason === 'over_cap') {
        throw new ValidationError(
          `Document exceeds the ${MAX_DOC_BYTES} byte cap and cannot be attached`,
          { path: input.path },
        );
      }
      if (!read.ok && read.reason === 'unsafe_path') {
        throw new ValidationError('Invalid document path', { path: input.path });
      }
    }

    // Absent order ⇒ append, so injection order is never arbitrary (§10).
    const order =
      input.order ?? existing.reduce((max, r) => Math.max(max, r.order + 1), 0);

    const row = await this.repo.insert({
      workspaceId,
      repoId: input.repo_id,
      kind: input.target_kind,
      targetId: input.target_id,
      path: input.path,
      order,
    });
    return toAttachmentDto(row);
  }

  async detach(workspaceId: string, id: string): Promise<void> {
    const ok = await this.repo.deleteById(workspaceId, id);
    if (!ok) throw new NotFoundError('Attachment not found');
  }

  async reorder(workspaceId: string, id: string, order: number): Promise<AttachmentRow> {
    const row = await this.repo.findById(workspaceId, id);
    if (!row) throw new NotFoundError('Attachment not found');
    await this.repo.setOrder(workspaceId, id, order);
    return toAttachmentDto({ ...row, order });
  }

  // -------------------------------------------------------------- resolution

  /**
   * Resolve, read and assemble everything one agent would send for a given repo.
   *
   * THE shared path, and after fix-brief F2 it is genuinely the only one: the
   * projection route calls it with the repo the user is looking at, and
   * `run-executor` calls it with the repo under review. AC-26 and AC-27 are
   * true because there is one function here, not two — `projectForAgent` below
   * is now a thin wrapper over this rather than a parallel implementation that
   * resolved each attachment against its OWN repo and so could never apply the
   * cross-repo skip.
   *
   * A failure to resolve the clone root is NOT thrown: `clone_missing` means
   * every document is skipped and the caller still completes (§6, "Every
   * attached document fails"). `resolveCloneRoot` rethrows anything that is not
   * ENOENT, so a permissions problem still reaches the normal error handling.
   */
  async resolveFor(
    workspaceId: string,
    agentId: string,
    repo: { id: string; clonePath: string | null },
  ): Promise<RunContext> {
    const attachments = await this.repo.resolveForAgent(workspaceId, agentId);
    const root = await resolveCloneRoot(repo.clonePath);

    const docs: ResolvedDoc[] = [];
    for (const [i, att] of attachments.entries()) {
      // F5's bound, applied BEFORE the read so an over-limit document costs no
      // `stat`, no 64 KB read and no tokenizer pass. It is still LISTED, with a
      // reason, exactly like every other skip — silently dropping documents the
      // user attached is the invisible failure this feature exists to remove.
      if (i >= MAX_DOCS_PER_RESOLUTION) {
        docs.push({
          path: att.path,
          repoId: att.repoId,
          origin: att.origin,
          viaSkillId: att.viaSkillId,
          content: null,
          skipReason: `over the ${MAX_DOCS_PER_RESOLUTION}-document per-resolution limit`,
        });
        continue;
      }
      docs.push(
        await this.readAttachment(
          att,
          repo.id,
          root.ok ? root.root : null,
          root.ok ? null : root.reason,
        ),
      );
    }

    const result = assembleProjectContext(docs, this.container.tokenizer, {
      budgetTokens: PROJECT_CONTEXT_TOKEN_BUDGET,
    });

    return { ...result, specsRead: specsReadFor(result) };
  }

  /**
   * REQ-10's projection for one agent, AGAINST ONE REPOSITORY, computed through
   * the same path the run uses (fix-brief F2).
   *
   * `repoId` is the repo the projection is for — the one whose PR would be
   * reviewed — and is required. It is what makes the D-6 cross-repo skip
   * reachable here: documents attached against another repository are listed as
   * `skipped`, which is what a run would do with them, instead of being
   * projected as if they would be injected.
   *
   * The delegation is the point. Any future divergence between "what the page
   * projects" and "what the run sends" now has to be introduced deliberately,
   * in one function, rather than by forgetting to mirror a change in the
   * second copy.
   */
  async projectForAgent(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<Projection> {
    if (!(await this.repo.targetExists(workspaceId, 'agent', agentId))) {
      throw new NotFoundError('Agent not found');
    }
    // A 404, never a 403, and never a silent empty projection: a repo id the
    // workspace does not own must not be answerable at all.
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');

    const result = await this.resolveFor(workspaceId, agentId, {
      id: repo.id,
      clonePath: repo.clonePath,
    });

    return {
      agent_id: agentId,
      repo_id: repo.id,
      budget_tokens: PROJECT_CONTEXT_TOKEN_BUDGET,
      // NOT the sum of the entries: it includes the wrappers and the heading.
      // The same number the run records (BQ-1/a), which is what AC-26 asserts.
      projected_tokens: result.sectionTokens,
      entries: result.entries,
    };
  }

  /**
   * Read one attachment through the containment gate, or classify why not.
   *
   * Reasons name a path and a cause, NEVER content (§7's observability-safety
   * row, which `prompt-log.test.ts` asserts mechanically against planted
   * secrets).
   */
  private async readAttachment(
    att: ResolvedAttachment,
    reviewRepoId: string,
    root: string | null,
    rootReason: 'not_cloned' | 'clone_missing' | null,
  ): Promise<ResolvedDoc> {
    const base = {
      path: att.path,
      repoId: att.repoId,
      origin: att.origin,
      viaSkillId: att.viaSkillId,
    };

    // D-6 — cross-repo. Skipped through the same path as a missing file, and
    // crucially BEFORE any read: resolving a same-named file from the repo under
    // review would silently feed one project's spec into another's review.
    if (att.repoId !== reviewRepoId) {
      return { ...base, content: null, skipReason: 'attached to a different repository' };
    }
    if (!root) {
      return {
        ...base,
        content: null,
        skipReason:
          rootReason === 'clone_missing'
            ? 'clone directory is missing on disk'
            : 'repository is not cloned',
      };
    }

    const read = await readDoc(root, att.path);
    if (read.ok) return { ...base, content: read.content };
    return { ...base, content: null, skipReason: READ_FAILURE_REASON[read.reason] };
  }
}

const READ_FAILURE_REASON = {
  unsafe_path: 'file not found or path refused',
  over_cap: `over the ${MAX_DOC_BYTES} byte per-document cap`,
  empty: 'document is empty',
  unreadable: 'document could not be read',
} as const;

