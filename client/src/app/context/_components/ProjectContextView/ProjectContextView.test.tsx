import React from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import contextMessages from "../../../../../messages/en/context.json";
import agentsMessages from "../../../../../messages/en/agents.json";
import skillsMessages from "../../../../../messages/en/skills.json";
import type { ContextDocList } from "@/lib/hooks/project-context";
import type { Agent, Skill } from "@devdigest/shared";

/**
 * `fireEvent`, not `userEvent`: `@testing-library/user-event` is not
 * installed in this package (client/INSIGHTS.md).
 *
 * Every data hook is mocked at the hook-function level (the house pattern —
 * `BlastCard.test.tsx`, `ProjectionSummary.test.tsx`) rather than mocking
 * `fetch`; a real `QueryClient` is still supplied because `useMutation`/
 * `useQueryClient` (attach/detach wiring) need a provider even though no
 * test here fires a mutation.
 */

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const useActiveRepo = vi.fn();
vi.mock("@/lib/repo-context", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useActiveRepo: (...args: unknown[]) => useActiveRepo(...args),
}));

const useContextDocs = vi.fn();
const useAgentContextProjection = vi.fn();
const useAttachContextDoc = vi.fn();
const useDetachContextDoc = vi.fn();
vi.mock("@/lib/hooks/project-context", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useContextDocs: (...args: unknown[]) => useContextDocs(...args),
  useAgentContextProjection: (...args: unknown[]) => useAgentContextProjection(...args),
  useAttachContextDoc: (...args: unknown[]) => useAttachContextDoc(...args),
  useDetachContextDoc: (...args: unknown[]) => useDetachContextDoc(...args),
}));

const useAgents = vi.fn();
vi.mock("@/lib/hooks/agents", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useAgents: (...args: unknown[]) => useAgents(...args),
}));

const useSkills = vi.fn();
const useAgentSkills = vi.fn();
vi.mock("@/lib/hooks/conventions", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useSkills: (...args: unknown[]) => useSkills(...args),
  useAgentSkills: (...args: unknown[]) => useAgentSkills(...args),
}));

// Resolves to the same module `AgentsTab`/`SkillsTab` import as `../DocumentList`
// (both sit alongside this file under `_components/`).
const useTargetAttachments = vi.fn();
vi.mock("../DocumentList", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useTargetAttachments: (...args: unknown[]) => useTargetAttachments(...args),
}));

import { ProjectContextView } from "./ProjectContextView";

afterEach(cleanup);

const REPO = { id: "repo-1", name: "acme/app", full_name: "acme/app", default_branch: "main" };

const NO_MUTATION = { mutate: vi.fn(), isPending: false, isError: false, error: null };

beforeEach(() => {
  useActiveRepo.mockReset();
  useContextDocs.mockReset();
  useAgentContextProjection.mockReset();
  useAttachContextDoc.mockReset();
  useDetachContextDoc.mockReset();
  useAgents.mockReset();
  useSkills.mockReset();
  useAgentSkills.mockReset();
  useTargetAttachments.mockReset();

  useActiveRepo.mockReturnValue({ activeRepo: REPO });
  useContextDocs.mockReturnValue({
    data: docList({}),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  useAgentContextProjection.mockReturnValue({ data: undefined, isLoading: false });
  useAttachContextDoc.mockReturnValue(NO_MUTATION);
  useDetachContextDoc.mockReturnValue(NO_MUTATION);
  useAgents.mockReturnValue({ data: [] as Agent[], isLoading: false });
  useSkills.mockReturnValue({ data: [] as Skill[], isLoading: false });
  useAgentSkills.mockReturnValue({ data: [] });
  useTargetAttachments.mockReturnValue({ data: [] });
});

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider
        locale="en"
        messages={{ context: contextMessages, agents: agentsMessages, skills: skillsMessages }}
      >
        <ProjectContextView />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function docList(overrides: Partial<ContextDocList>): ContextDocList {
  return {
    files: [],
    capped: false,
    reason: null,
    last_synced_at: null,
    ...overrides,
  };
}

describe("ProjectContextView — F3: the two clone states render distinct, non-error copy", () => {
  it("not_cloned states the repository hasn't been cloned yet", () => {
    useContextDocs.mockReturnValue({
      data: docList({ reason: "not_cloned" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("This repository hasn’t been cloned yet.")).toBeInTheDocument();
    expect(
      screen.queryByText("The local clone is missing on disk. Resync the repository to restore it."),
    ).not.toBeInTheDocument();
    // Not rendered as an error state (no alert role from ErrorState).
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("clone_missing states the clone is missing on disk — different copy from not_cloned", () => {
    useContextDocs.mockReturnValue({
      data: docList({ reason: "clone_missing" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(
      screen.getByText("The local clone is missing on disk. Resync the repository to restore it."),
    ).toBeInTheDocument();
    expect(screen.queryByText("This repository hasn’t been cloned yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("ProjectContextView — AC-15: cardinality zero", () => {
  it("renders the empty state rather than a blank list", () => {
    useContextDocs.mockReturnValue({
      data: docList({ files: [] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();
    expect(screen.getByText("No documents found")).toBeInTheDocument();
  });
});

describe("ProjectContextView — AC-8 and AC-16: the document list", () => {
  it("shows an estimate marker beside a token count, never claiming exactness, and a usage count of 2", () => {
    useContextDocs.mockReturnValue({
      data: docList({
        files: [
          {
            path: "docs/a.md",
            tokens_estimate: 500,
            used_by_count: 2,
            size: 900,
            content: null,
            updated_at: null,
            over_cap: false,
          },
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderPage();

    // AC-8 — the marker is present, and no copy anywhere claims exactness.
    expect(screen.getByText("estimated")).toBeInTheDocument();
    expect(screen.queryByText(/exact/i)).not.toBeInTheDocument();

    // AC-16 — usage count reads 2.
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});

describe("ProjectContextView — AC-29: the Skills tab shows a contribution figure, not a budget", () => {
  it("sums the skill's attached documents with no budget fraction and no drop marking", () => {
    useContextDocs.mockReturnValue({
      data: docList({
        files: [
          { path: "docs/a.md", tokens_estimate: 1000, used_by_count: 1, size: 10, content: null, updated_at: null },
          { path: "docs/b.md", tokens_estimate: 1200, used_by_count: 1, size: 10, content: null, updated_at: null },
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    useSkills.mockReturnValue({
      data: [{ id: "skill-1", name: "Security Skill", description: "", type: "security", source: "manual", body: "", enabled: true, version: 1 }],
      isLoading: false,
    });
    useTargetAttachments.mockImplementation((kind: string) =>
      kind === "skill"
        ? {
            data: [
              { id: "att-1", path: "docs/a.md", repo_id: "repo-1", target_kind: "skill", target_id: "skill-1", order: 0 },
              { id: "att-2", path: "docs/b.md", repo_id: "repo-1", target_kind: "skill", target_id: "skill-1", order: 1 },
            ],
          }
        : { data: [] },
    );

    renderPage();
    fireEvent.click(screen.getByText("Skills"));

    // The contribution figure: 1000 + 1200 = 2,200, estimated.
    expect(screen.getByText("2,200 tokens across its attached documents")).toBeInTheDocument();
    // Never a budget fraction, and never drop marking — both are unknowable
    // at skill level (D-10).
    expect(screen.queryByText(/\/ 8,000 tokens/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dropped/)).not.toBeInTheDocument();
  });
});

describe("ProjectContextView — no repository selected (§6)", () => {
  it("prompts to select a repo rather than erroring", () => {
    useActiveRepo.mockReturnValue({ activeRepo: null });
    renderPage();
    expect(screen.getByText("No repository selected")).toBeInTheDocument();
  });
});

/**
 * Fix-brief F4 — an attachment belongs to a (repo, path) PAIR.
 *
 * `listForTarget` returns every attachment on a target across ALL repositories
 * and the rows carry `repo_id`, which the tabs discarded: `attachedPaths` was
 * built from `a.path` alone. With `docs/prd.md` attached from repo-2 and repo-1
 * active, the toggle rendered ON for a document that is not attached here — so
 * repo-1's copy could never be attached — and switching it off ran
 * `find(a => a.path === doc.path)`, which returns repo-2's row, DELETEing an
 * attachment belonging to a repository the user is not looking at.
 *
 * This is the first client test to render `AgentsTab` with a NON-EMPTY agent
 * list, which is why the defect was invisible: every existing case falls into
 * the "no agents" empty state before reaching the document rows.
 */
describe("ProjectContextView — F4: attachments are matched on (repo_id, path)", () => {
  const AGENT = {
    id: "agent-1",
    name: "Security Reviewer",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "p",
    enabled: true,
    version: 1,
  } as unknown as Agent;

  const DOCS = docList({
    files: [
      {
        path: "docs/prd.md",
        tokens_estimate: 500,
        size: 900,
        content: null,
        updated_at: null,
        over_cap: false,
      },
    ],
  });

  /** The same path, attached against a DIFFERENT repository. */
  const FOREIGN_ROW = {
    id: "att-foreign",
    path: "docs/prd.md",
    repo_id: "repo-2",
    target_kind: "agent" as const,
    target_id: "agent-1",
    order: 0,
  };

  beforeEach(() => {
    useAgents.mockReturnValue({ data: [AGENT], isLoading: false });
    useContextDocs.mockReturnValue({
      data: DOCS,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("renders the toggle OFF for a document attached only from another repo", () => {
    useTargetAttachments.mockImplementation((kind: string) =>
      kind === "agent" ? { data: [FOREIGN_ROW] } : { data: [] },
    );
    renderPage();

    // `Toggle` renders role="switch" and has no label text (client/INSIGHTS.md).
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  it("renders the toggle ON for a document attached from the ACTIVE repo", () => {
    useTargetAttachments.mockImplementation((kind: string) =>
      kind === "agent"
        ? { data: [{ ...FOREIGN_ROW, id: "att-local", repo_id: "repo-1" }] }
        : { data: [] },
    );
    renderPage();
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("attaches this repo`s copy rather than being blocked by the other repo`s row", () => {
    const mutate = vi.fn();
    useTargetAttachments.mockImplementation((kind: string) =>
      kind === "agent" ? { data: [FOREIGN_ROW] } : { data: [] },
    );
    useAttachContextDoc.mockReturnValue({ ...NO_MUTATION, mutate });
    renderPage();

    fireEvent.click(screen.getByRole("switch"));

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0]![0]).toMatchObject({
      path: "docs/prd.md",
      repo_id: "repo-1",
      target_kind: "agent",
      target_id: "agent-1",
    });
  });

  it("never detaches another repository`s attachment", () => {
    const mutate = vi.fn();
    useTargetAttachments.mockImplementation((kind: string) =>
      kind === "agent"
        ? { data: [FOREIGN_ROW, { ...FOREIGN_ROW, id: "att-local", repo_id: "repo-1" }] }
        : { data: [] },
    );
    useDetachContextDoc.mockReturnValue({ ...NO_MUTATION, mutate });
    renderPage();

    // Attached here (repo-1's row exists), so clicking detaches...
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch"));

    expect(mutate).toHaveBeenCalledTimes(1);
    // ...repo-1's row. `find` on path alone returns `att-foreign`, which is
    // first in the list — the deletion of a row the user cannot even see.
    expect(mutate.mock.calls[0]![0]).toMatchObject({ id: "att-local", repo_id: "repo-1" });
  });

  it("scopes the Skills tab the same way", () => {
    useSkills.mockReturnValue({
      data: [
        {
          id: "skill-1",
          name: "Security Skill",
          description: "",
          type: "security",
          source: "manual",
          body: "",
          enabled: true,
          version: 1,
        },
      ],
      isLoading: false,
    });
    useTargetAttachments.mockImplementation((kind: string) =>
      kind === "skill"
        ? { data: [{ ...FOREIGN_ROW, target_kind: "skill", target_id: "skill-1" }] }
        : { data: [] },
    );
    renderPage();
    fireEvent.click(screen.getByText("Skills"));

    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    // The contribution figure reads the same set, so it must not count the
    // other repository's document either.
    expect(screen.queryByText(/500 tokens across/)).not.toBeInTheDocument();
  });
});
