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
