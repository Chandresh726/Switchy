import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MatcherSection } from "@/components/settings/matcher-section";

function createProps() {
  return {
    availableProviders: [{ id: "provider-1", provider: "openai", name: "OpenAI" }],
    hasProviders: true,
    models: [{
      modelId: "gpt-5-mini",
      label: "GPT-5 mini",
      description: "Test model",
      supportsReasoning: true,
    }],
    modelsLoading: false,
    modelsStale: false,
    matcherProviderId: "provider-1",
    onMatcherProviderIdChange: vi.fn(),
    matcherModel: "gpt-5-mini",
    onMatcherModelChange: vi.fn(),
    matcherReasoningEffort: "medium" as const,
    onMatcherReasoningEffortChange: vi.fn(),
    qualityPreset: "balanced" as const,
    onQualityPresetChange: vi.fn(),
    acceptedLocationTypes: ["remote"],
    onAcceptedLocationTypesChange: vi.fn(),
    acceptedEmploymentTypes: ["full-time"],
    onAcceptedEmploymentTypesChange: vi.fn(),
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
    onSave: vi.fn(),
    isSaving: false,
    hasUnsavedChanges: false,
    settingsSaved: false,
    onMatchUnmatched: vi.fn(),
    isMatching: false,
    unmatchedCount: 0,
  };
}

describe("MatcherSection", () => {
  it("selects a matching quality preset", () => {
    const props = createProps();
    render(<MatcherSection {...props} />);

    expect(
      screen.getByRole("button", { name: /Balanced/ }).getAttribute("aria-pressed")
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /Quality/ }));

    expect(props.onQualityPresetChange).toHaveBeenCalledWith("quality");
  });

  it("updates accepted work arrangements and employment types", () => {
    const props = createProps();
    render(<MatcherSection {...props} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "hybrid" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Contract" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Internship" }));

    expect(props.onAcceptedLocationTypesChange).toHaveBeenCalledWith([
      "remote",
      "hybrid",
    ]);
    expect(props.onAcceptedEmploymentTypesChange).toHaveBeenCalledWith([
      "full-time",
      "contract",
    ]);
    expect(props.onAcceptedEmploymentTypesChange).toHaveBeenCalledWith([
      "full-time",
      "intern",
    ]);
  });

  it("keeps operational overrides behind Advanced settings", () => {
    render(<MatcherSection {...createProps()} />);

    expect(screen.queryByLabelText("Analysis batch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));

    expect(screen.getByText("Reasoning effort")).toBeTruthy();
    expect(screen.getByLabelText("Analysis batch")).toBeTruthy();
    expect(screen.getByLabelText("Max attempts")).toBeTruthy();
    expect(screen.getByLabelText("Timeout (sec)")).toBeTruthy();
    expect(screen.getByLabelText("Concurrency")).toBeTruthy();
  });
});
