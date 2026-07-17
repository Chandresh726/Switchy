import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { Briefcase } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DashboardPage from "@/app/(dashboard)/page";
import JobDetailPage from "@/app/(dashboard)/jobs/[id]/page";
import { AIWorkspacePage } from "@/components/ai-workspace/ai-workspace-page";
import { JobList } from "@/components/jobs/job-list";
import { queryKeys } from "@/lib/query-keys";

const mocks = vi.hoisted(() => ({
  getCompanies: vi.fn(),
  getJob: vi.fn(),
  getJobs: vi.fn(),
  getProfile: vi.fn(),
  getStats: vi.fn(),
  replace: vi.fn(),
  routeId: "42",
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: mocks.routeId }),
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api/clients/companies", () => ({
  getCompanies: mocks.getCompanies,
}));
vi.mock("@/lib/api/clients/jobs", () => ({
  getJob: mocks.getJob,
  getJobs: mocks.getJobs,
  updateJob: vi.fn(),
}));
vi.mock("@/lib/api/clients/profile", () => ({ getProfile: mocks.getProfile }));
vi.mock("@/lib/api/clients/stats", () => ({ getStats: mocks.getStats }));
vi.mock("@/lib/hooks/use-queued-job-match", () => ({
  useQueuedJobMatch: () => ({
    mutation: { isPending: false, mutate: vi.fn() },
    isMatching: false,
  }),
}));
vi.mock("@/lib/ai/writing/workspace/use-ai-content-workspace", () => ({
  useAIContentWorkspace: () => ({
    content: null,
    currentContent: "",
    currentVariantIndex: 0,
    currentVariantPrompt: null,
    discardCurrentVariant: vi.fn(),
    hasChanges: false,
    isContentLoading: false,
    isDiscarding: false,
    isSaving: false,
    isSending: false,
    modificationPrompt: "",
    navigateVariant: vi.fn(),
    recordCurrentVariantCopied: vi.fn(),
    resetChanges: vi.fn(),
    saveEdit: vi.fn(),
    sendModification: vi.fn(),
    setEditedContent: vi.fn(),
    setModificationPrompt: vi.fn(),
  }),
}));

const listJob = {
  id: 42,
  companyId: 7,
  externalId: "job-42",
  title: "Canonical Backend Engineer",
  descriptionFormat: "markdown" as const,
  url: "https://example.test/jobs/42",
  location: "Remote",
  locationType: "remote",
  salary: null,
  department: "Engineering",
  employmentType: "full-time",
  seniorityLevel: "senior",
  status: "viewed" as const,
  postedDate: "2026-07-16T00:00:00.000Z",
  discoveredAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
  archivedAt: null,
  archiveSource: null,
  viewedAt: "2026-07-16T00:00:00.000Z",
  appliedAt: null,
  matchScore: 88,
  matchReasons: ["Strong experience fit"],
  matchedSkills: ["TypeScript"],
  matchResultId: "result-42",
  matchBreakdown: null,
  matchStale: false,
  matchLegacy: false,
  matchSummary: "Strong match",
  matchReasoning: [],
  matchRunId: "run-42",
  matchPolicyVersion: "policy-1",
  scoringPolicyVersion: "policy-1",
  company: {
    id: 7,
    name: "Example Company",
    logoUrl: null,
    platform: "custom",
  },
};

const detailJob = { ...listJob, description: "Build reliable local software." };

const company = {
  id: 7,
  name: "Example Company",
  careersUrl: "https://example.test/careers",
  logoUrl: null,
  notes: null,
  platform: "custom",
  boardToken: null,
  isActive: true,
  lastScrapedAt: null,
  createdAt: "2026-07-16T00:00:00.000Z",
  updatedAt: "2026-07-16T00:00:00.000Z",
};

function renderWithClient(ui: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
  return queryClient;
}

describe("job data consumers", () => {
  beforeEach(() => {
    mocks.routeId = "42";
    mocks.getJob.mockClear();
    mocks.getCompanies.mockResolvedValue([company]);
    mocks.getJob.mockResolvedValue(detailJob);
    mocks.getProfile.mockResolvedValue({ id: 1, name: "Test User" });
    mocks.getStats.mockResolvedValue({
      totalJobs: 3,
      totalCompanies: 1,
      highMatchJobs: 1,
      appliedJobs: 1,
      newJobs: 1,
      viewedJobs: 1,
      savedJobs: 0,
      jobsWithScore: 1,
      lastScan: null,
      totalPeople: 0,
      starredPeople: 0,
      mappedPeople: 0,
      unmatchedCompanyCount: 0,
    });
  });

  it("renders dashboard recent, top-match, and applied job responses", async () => {
    mocks.getJobs.mockImplementation(async (params: { status?: string; matchBands?: string[] }) => {
      if (params.status === "applied") {
        return {
          jobs: [{ ...listJob, id: 44, title: "Recently Applied Engineer", status: "applied", appliedAt: "2026-07-16T01:00:00.000Z" }],
          totalCount: 1,
          hasMore: false,
        };
      }
      if (params.matchBands) {
        return { jobs: [{ ...listJob, id: 43, title: "Top Match Engineer" }], totalCount: 1, hasMore: false };
      }
      return { jobs: [listJob], totalCount: 1, hasMore: false };
    });

    renderWithClient(<DashboardPage />);

    expect(await screen.findByText("Canonical Backend Engineer")).toBeTruthy();
    expect(screen.getByText("Top Match Engineer")).toBeTruthy();
    expect(screen.getByText("Recently Applied Engineer")).toBeTruthy();
  });

  it("renders the jobs list from the canonical paginated response", async () => {
    mocks.getJobs.mockImplementation(async (params: { status?: string }) => {
      if (params.status === "applied" || params.status === "interested" || params.status === "archived") {
        return { jobs: [], totalCount: 0, hasMore: false };
      }
      return { jobs: [listJob], totalCount: 1, hasMore: false };
    });

    renderWithClient(<JobList />);

    expect(await screen.findByText("Canonical Backend Engineer")).toBeTruthy();
    expect(screen.getByText("1-1 of 1")).toBeTruthy();
  });

  it("stores and renders the job-detail resource directly", async () => {
    const queryClient = renderWithClient(<JobDetailPage />);

    expect(await screen.findByText("Canonical Backend Engineer")).toBeTruthy();
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.jobs.detail(42))).toEqual(detailJob));
    expect(mocks.getJob).toHaveBeenCalledWith(42);
  });

  it("stores and renders the AI workspace job resource directly", async () => {
    const queryClient = renderWithClient(
      <AIWorkspacePage
        contentType="cover_letter"
        emptyStateDescription="Unable to load job"
        icon={Briefcase}
        iconClassName="text-emerald-500"
        title="Cover Letter"
        workspaceHint="Tailor the letter"
      />
    );

    expect(await screen.findByText("Canonical Backend Engineer at Example Company")).toBeTruthy();
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.jobs.detail(42))).toEqual(detailJob));
    expect(mocks.getJob).toHaveBeenCalledWith(42);
  });

  it("does not request job resources for an invalid route ID", async () => {
    mocks.routeId = "not-a-job";

    renderWithClient(<JobDetailPage />);

    expect(await screen.findByText("Job not found")).toBeTruthy();
    expect(mocks.getJob).not.toHaveBeenCalled();
  });
});
