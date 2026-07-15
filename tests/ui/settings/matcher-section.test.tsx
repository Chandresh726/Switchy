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

    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toBeTruthy();
    expect(screen.queryByLabelText("Analysis batch")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));

    expect(screen.getByLabelText("Analysis batch")).toBeTruthy();
    expect(screen.getByLabelText("Max attempts")).toBeTruthy();
    expect(screen.getByLabelText("Timeout (sec)")).toBeTruthy();
    expect(screen.getByLabelText("Concurrency")).toBeTruthy();
  });

  it("uses provider default when the model does not publish exact efforts", () => {
    const props = createProps();
    props.models[0].supportsReasoning = false;
    props.models[0].reasoningControl = { kind: "provider_default" };

    render(<MatcherSection {...props} />);

    expect(screen.queryByRole("combobox", { name: "Reasoning effort" })).toBeNull();
    expect(screen.getByText("Provider default")).toBeTruthy();
  });

  it("renders provider-native effort values and blocks a stale selection", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const props = createProps();
    props.hasUnsavedChanges = true;
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
    fireEvent.click(screen.getByRole("combobox", { name: "Reasoning effort" }));

    expect(screen.getByText("XHigh")).toBeTruthy();
    expect(screen.getByText("Max")).toBeTruthy();
    expect(screen.getByText("Future V1")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });
    expect(screen.getByText(/choose an advertised value/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it("retains an unavailable configured model with a clear warning", () => {
    const props = createProps();
    props.matcherModel = "retired-model";

    render(<MatcherSection {...props} />);

    expect(screen.getByText("Configured: retired-model")).toBeTruthy();
    expect(screen.getByText(/configured model is unavailable/i)).toBeTruthy();
  });

  it("retains saved model and reasoning values when the catalog is empty", () => {
    const props = createProps();
    props.models = [];
    props.modelsError = "Catalog unavailable";
    props.matcherModel = "retired-model";
    props.matcherReasoningEffort = "xhigh";
    props.hasUnsavedChanges = true;

    render(<MatcherSection {...props} />);

    expect(screen.getByText("Configured: retired-model")).toBeTruthy();
    expect(screen.getByText("xhigh (unavailable)")).toBeTruthy();
    expect(screen.getByText(/configured model is unavailable/i)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled
    ).toBe(true);
  });
});
