import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MatcherSection,
  type MatcherSectionProps,
} from "@/components/settings/matcher-section";

function createProps(): MatcherSectionProps {
  return {
    availableProviders: [{ id: "provider-1", provider: "openai", name: "OpenAI" }],
    hasProviders: true,
    jobAnalysisModels: [{
      modelId: "gpt-5-mini",
      label: "GPT-5 mini",
      description: "Test analysis model",
      supportsReasoning: true,
      reasoningControl: {
        kind: "effort" as const,
        options: ["low", "medium", "high"].map((value) => ({ value })),
        defaultValue: "medium",
      },
    }],
    jobAnalysisModelsLoading: false,
    jobAnalysisModelsStale: false,
    jobAnalysisProviderId: "provider-1",
    onJobAnalysisProviderIdChange: vi.fn(),
    jobAnalysisModel: "gpt-5-mini",
    onJobAnalysisModelChange: vi.fn(),
    jobAnalysisReasoningEffort: "medium",
    onJobAnalysisReasoningEffortChange: vi.fn(),
    models: [{
      modelId: "gpt-5-mini",
      label: "GPT-5 mini",
      description: "Test model",
      supportsReasoning: true,
      reasoningControl: {
        kind: "effort" as const,
        options: ["low", "medium", "high"].map((value) => ({ value })),
        defaultValue: "medium",
      },
    }],
    modelsLoading: false,
    modelsStale: false,
    matcherProviderId: "provider-1",
    onMatcherProviderIdChange: vi.fn(),
    matcherModel: "gpt-5-mini",
    onMatcherModelChange: vi.fn(),
    matcherReasoningEffort: "medium" as const,
    onMatcherReasoningEffortChange: vi.fn(),
    autoMatchAfterScrape: false,
    onAutoMatchAfterScrapeChange: vi.fn(),
    batchSize: 5,
    onBatchSizeChange: vi.fn(),
    maxRetries: 3,
    onMaxRetriesChange: vi.fn(),
    concurrencyLimit: 2,
    onConcurrencyLimitChange: vi.fn(),
    timeoutMs: 30_000,
    onTimeoutMsChange: vi.fn(),
    onMatchUnmatched: vi.fn(),
    isMatching: false,
    unmatchedWindowDays: 5,
    onUnmatchedWindowDaysChange: vi.fn(),
    onUnmatchedWindowOpen: vi.fn(),
    unmatchedCount: 0,
    unmatchedCountLoading: false,
  };
}

describe("MatcherSection", () => {
  it("shows separate AI analysis and match stages without preference controls", () => {
    render(<MatcherSection {...createProps()} />);

    expect(screen.queryByText("Candidate Snapshot")).toBeNull();
    expect(screen.getByText("Job Analysis")).toBeTruthy();
    expect(screen.getByText("Final Match")).toBeTruthy();
    expect(screen.queryByText("Accepted work arrangements")).toBeNull();
    expect(screen.queryByText("Accepted employment types")).toBeNull();
    expect(screen.queryByText("Matching quality")).toBeNull();
  });

  it("keeps operational overrides behind Advanced settings", () => {
    render(<MatcherSection {...createProps()} />);

    expect(screen.getByRole("combobox", { name: "Job analysis reasoning effort" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Final match reasoning effort" })).toBeTruthy();
    expect(screen.queryByLabelText("Analysis batch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));

    expect(screen.getByLabelText("Analysis batch")).toBeTruthy();
    expect(screen.getByLabelText("Max attempts")).toBeTruthy();
    expect(screen.getByLabelText("Timeout (sec)")).toBeTruthy();
    expect(screen.getByLabelText("Concurrency")).toBeTruthy();
  });

  it("hides reasoning when the model does not publish selectable efforts", () => {
    const props = createProps();
    props.models[0].supportsReasoning = false;
    props.models[0].reasoningControl = { kind: "provider_default" };

    render(<MatcherSection {...props} />);

    expect(screen.queryByRole("combobox", { name: "Final match reasoning effort" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Job analysis reasoning effort" })).toBeTruthy();
    expect(screen.queryByText("Provider default")).toBeNull();
  });

  it("renders provider-native effort values and blocks a stale selection", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const props = createProps();
    props.matcherReasoningEffort = "retired";
    props.models[0].reasoningControl = {
      kind: "effort",
      options: [
        { value: "xhigh", label: "XHigh" },
        { value: "max" },
        { value: "future_v1" },
      ],
      defaultValue: "xhigh",
    };

    render(<MatcherSection {...props} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Final match reasoning effort" }));

    expect(screen.getByText("XHigh")).toBeTruthy();
    expect(screen.getByText("Max")).toBeTruthy();
    expect(screen.getByText("Future V1")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.getByText(/choose an advertised value/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("retains an unavailable configured model with a clear warning", () => {
    const props = createProps();
    props.matcherModel = "retired-model";

    render(<MatcherSection {...props} />);

    expect(screen.getByText("Configured: retired-model")).toBeTruthy();
    expect(screen.getByText(/choose an available model/i)).toBeTruthy();
  });

  it("retains the saved model but hides reasoning when the catalog is empty", () => {
    const props = createProps();
    props.models = [];
    props.modelsError = "Catalog unavailable";
    props.matcherModel = "retired-model";
    props.matcherReasoningEffort = "xhigh";

    render(<MatcherSection {...props} />);

    expect(screen.getByText("Configured: retired-model")).toBeTruthy();
    expect(screen.queryByText("xhigh (unavailable)")).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Final match reasoning effort" })).toBeNull();
    expect(screen.getByText(/choose an available model/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("previews a numeric discovery window and requires confirmation", () => {
    const props = createProps();
    props.unmatchedCount = 12;

    const { rerender } = render(<MatcherSection {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Match recent jobs" }));

    expect(props.onUnmatchedWindowOpen).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByLabelText("Jobs found within") as HTMLInputElement).value).toBe("5");
    expect(screen.getByText("Unmatched jobs found")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Jobs found within"), {
      target: { value: "10" },
    });
    expect(props.onUnmatchedWindowDaysChange).toHaveBeenCalledWith(10);
    props.unmatchedWindowDays = 10;
    rerender(<MatcherSection {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "Match 12 jobs" }));
    expect(props.onMatchUnmatched).toHaveBeenCalledWith(10);
  });

  it("shows live analysis and matching stages for an active session", () => {
    const props = createProps();
    props.isMatching = true;
    props.matchProgress = {
      sessionId: "session-1",
      status: "in_progress",
      total: 2,
      completed: 1,
      succeeded: 1,
      failed: 0,
      startedAt: null,
      completedAt: null,
      analysis: { total: 2, completed: 2, active: 0, queued: 0, cached: 1, failed: 0 },
      matching: { total: 2, completed: 1, active: 1, queued: 0, cached: 0, failed: 0 },
      jobPagination: { total: 5_000, limit: 100, offset: 0, hasMore: true },
      jobs: [{
        jobId: 1,
        jobTitle: "Platform Engineer",
        companyName: "Acme",
        analysisStatus: "ready",
        matchStatus: "matching",
        errorStage: null,
        errorCode: null,
        errorMessage: null,
        analysisStartedAt: null,
        analysisCompletedAt: null,
        matchStartedAt: null,
        matchCompletedAt: null,
        updatedAt: new Date().toISOString(),
      }],
    };

    render(<MatcherSection {...props} />);

    expect(screen.getByText("4999 more jobs are in this session.")).toBeTruthy();

    expect(screen.getByText("Job analysis")).toBeTruthy();
    expect(screen.getByText("Final matching")).toBeTruthy();
    expect(screen.getByText("Platform Engineer")).toBeTruthy();
    expect(screen.getByText("Matching")).toBeTruthy();
  });
});
