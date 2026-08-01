import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ResumeHistoryDetailResponse,
  ResumeHistoryEntry,
  ResumeHistoryResponse,
} from "@/lib/api/contracts/history";

const mocks = vi.hoisted(() => ({
  getResumeHistoryDetail: vi.fn(),
  getResumeHistoryList: vi.fn(),
}));

vi.mock("@/lib/api/clients/history", () => ({
  getResumeHistoryDetail: mocks.getResumeHistoryDetail,
  getResumeHistoryList: mocks.getResumeHistoryList,
}));

vi.mock("@/components/history/ai-usage-overview", () => ({
  AIUsageOverview: () => <div>Usage overview</div>,
}));

import ResumeHistoryPage from "@/app/(dashboard)/history/ai/resume/page";
import { ResumeHistoryDetail } from "@/components/history/resume-history-detail";

const stats: ResumeHistoryResponse["stats"] = {
  totalUploads: 21,
  uploadOnly: 0,
  failedParses: 0,
  successRate: 100,
  avgDuration: 500,
  lastUploadAt: "2026-07-20T10:00:00.000Z",
};

function entry(id: number, fileName: string): ResumeHistoryEntry {
  return {
    id: `resume:${id}`,
    source: "resume",
    resumeId: id,
    fileName,
    fileType: "pdf",
    fileSizeBytes: 2_048,
    version: id,
    isCurrent: id === 1,
    storageState: "ready",
    parseState: "parsed",
    parserVersion: "resume-normalizer-v2",
    parsedSummary: {
      skillCount: 1,
      experienceCount: 1,
      educationCount: 1,
    },
    warnings: [],
    aiRunId: null,
    aiRun: null,
    createdAt: "2026-07-20T10:00:00.000Z",
  };
}

describe("ResumeHistoryPage", () => {
  afterEach(() => {
    mocks.getResumeHistoryDetail.mockReset();
    mocks.getResumeHistoryList.mockReset();
  });

  it("requests and renders later pages with the shared pagination control", async () => {
    mocks.getResumeHistoryList.mockImplementation(
      async ({ offset }: { limit?: number; offset?: number } = {}) => ({
        entries: offset === 20
          ? [entry(21, "older-resume.pdf")]
          : [entry(1, "latest-resume.pdf")],
        pagination: {
          total: 21,
          limit: 20,
          offset: offset ?? 0,
          hasMore: offset !== 20,
        },
        stats,
      })
    );
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ResumeHistoryPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("latest-resume.pdf")).toBeTruthy();
    expect(screen.getByRole("link", { name: /latest-resume\.pdf/ })
      .getAttribute("href")).toBe("/history/ai/resume/resume%3A1");
    expect(screen.queryByText("Extracted data")).toBeNull();
    expect(screen.queryByText(/AI telemetry/)).toBeNull();
    expect(screen.getByRole("navigation", {
      name: "Resume history pagination",
    })).toBeTruthy();
    expect(screen.getByText("1-20 of 21 entries")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));

    expect(await screen.findByText("older-resume.pdf")).toBeTruthy();
    await waitFor(() => {
      expect(mocks.getResumeHistoryList).toHaveBeenLastCalledWith({
        limit: 20,
        offset: 20,
      });
    });
    expect(screen.getByText("21-21 of 21 entries")).toBeTruthy();
  });

  it("hides pagination when all resume history entries fit on one page", async () => {
    mocks.getResumeHistoryList.mockResolvedValue({
      entries: [entry(1, "latest-resume.pdf")],
      pagination: {
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      },
      stats: { ...stats, totalUploads: 1 },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ResumeHistoryPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("latest-resume.pdf")).toBeTruthy();
    expect(screen.queryByRole("navigation", {
      name: "Resume history pagination",
    })).toBeNull();
  });

  it("renders complete extracted data and telemetry on the detail page", async () => {
    const detailEntry = entry(1, "latest-resume.pdf");
    detailEntry.warnings = [{
      code: "malformed_date",
      path: "experience.0.endDate",
      message: "Date should use YYYY-MM format.",
    }];
    detailEntry.aiRunId = "resume-run-1";
    detailEntry.aiRun = {
      id: "resume-run-1",
      capability: "resume_parse",
      provider: "openai",
      modelId: "gpt-5",
      status: "succeeded",
      attempts: 1,
      inputTokens: 100,
      inputNoCacheTokens: 100,
      inputCacheReadTokens: 0,
      inputCacheWriteTokens: 0,
      outputTokens: 20,
      outputTextTokens: 20,
      outputReasoningTokens: 0,
      totalTokens: 120,
      durationMs: 800,
      finishReason: "stop",
      providerRequestId: null,
      providerConfigFingerprint: null,
      cacheStatus: "miss",
      qualityResult: "passed",
      warningCodes: [],
      errorCode: null,
      startedAt: "2026-07-20T09:59:59.200Z",
      completedAt: "2026-07-20T10:00:00.000Z",
      attemptHistory: [],
    };
    const response: ResumeHistoryDetailResponse = {
      entry: detailEntry,
      parsedData: {
        name: "Alex Rivera",
        email: "alex@example.com",
        summary: "Staff engineer focused on reliable systems.",
        skills: [{ name: "TypeScript", category: "Languages" }],
        experience: [{
          company: "Acme",
          title: "Staff Engineer",
          location: "Remote",
          startDate: "2024-01",
          endDate: null,
          description: "Built reliable services.",
          highlights: ["Reduced latency"],
        }],
        education: [{
          institution: "State University",
          degree: "BS",
          field: "Computer Science",
        }],
      },
    };
    mocks.getResumeHistoryDetail.mockResolvedValue(response);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ResumeHistoryDetail entryId="resume:1" />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "latest-resume.pdf" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Extracted resume data" })).toBeTruthy();
    expect(screen.getByText("alex@example.com")).toBeTruthy();
    expect(screen.getByText("Staff engineer focused on reliable systems.")).toBeTruthy();
    expect(screen.getByText("TypeScript · Languages")).toBeTruthy();
    expect(screen.getByText("Built reliable services.")).toBeTruthy();
    expect(screen.getByText("Reduced latency")).toBeTruthy();
    expect(screen.getByText("State University · Computer Science")).toBeTruthy();
    expect(screen.getByText("Date should use YYYY-MM format.")).toBeTruthy();
    expect(screen.getByText("AI telemetry · 1 run")).toBeTruthy();
  });
});
