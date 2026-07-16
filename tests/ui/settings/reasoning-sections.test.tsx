import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIWritingSection } from "@/components/settings/ai-writing-section";
import { resolveReasoningSelection } from "@/components/settings/reasoning-effort-control";
import { ResumeParserSection } from "@/components/settings/resume-parser-section";
import type { ProviderModelOption } from "@/lib/types";

const providers = [{ id: "provider-1", provider: "opencode_cli", name: "OpenCode" }];
const models: ProviderModelOption[] = [{
  modelId: "openai/future-model",
  label: "Future model",
  description: "Synthetic model",
  supportsReasoning: true,
  reasoningControl: {
    kind: "effort",
    options: [{ value: "xhigh" }, { value: "max" }],
    defaultValue: "xhigh",
  },
  supportedReasoningEfforts: ["xhigh", "max"],
  defaultReasoningEffort: "xhigh",
}];

describe("dynamic reasoning placement", () => {
  it("uses the advertised default when matcher provider selection changes", () => {
    expect(resolveReasoningSelection({
      savedValue: "low",
      providerWasEdited: true,
      model: models[0],
    })).toBe("xhigh");
  });

  it("uses the first advertised option when writing provider selection changes", () => {
    expect(resolveReasoningSelection({
      savedValue: "high",
      providerWasEdited: true,
      model: {
        ...models[0],
        reasoningControl: {
          kind: "effort",
          options: [{ value: "future_v1" }, { value: "max" }],
        },
      },
    })).toBe("future_v1");
  });

  it("clears reasoning when resume provider selection uses provider defaults", () => {
    expect(resolveReasoningSelection({
      savedValue: "medium",
      providerWasEdited: true,
      model: {
        ...models[0],
        reasoningControl: { kind: "provider_default" },
      },
    })).toBe("");
  });

  it("keeps provider-native reasoning beside the writing model", () => {
    render(<AIWritingSection
      availableProviders={providers}
      hasProviders
      models={models}
      modelsLoading={false}
      modelsStale={false}
      aiWritingProviderId="provider-1"
      onAIWritingProviderIdChange={vi.fn()}
      aiWritingSettings={{
        referralTone: "professional",
        referralLength: "medium",
        followUpTone: "professional",
        followUpLength: "medium",
        coverLetterTone: "professional",
        coverLetterLength: "medium",
        coverLetterFocus: ["skills"],
        aiWritingModel: "openai/future-model",
        aiWritingProviderId: "provider-1",
        aiWritingReasoningEffort: "xhigh",
      }}
      onAIWritingSettingsChange={vi.fn()}
    />);

    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toBeTruthy();
  });

  it("keeps provider-native reasoning beside the resume parser model", () => {
    render(<ResumeParserSection
      availableProviders={providers}
      hasProviders
      models={models}
      modelsLoading={false}
      modelsStale={false}
      resumeParserProviderId="provider-1"
      onResumeParserProviderIdChange={vi.fn()}
      resumeParserModel="openai/future-model"
      onResumeParserModelChange={vi.fn()}
      resumeParserReasoningEffort="max"
      onResumeParserReasoningEffortChange={vi.fn()}
    />);

    expect(screen.getByRole("combobox", { name: "Reasoning effort" })).toBeTruthy();
  });

  it("retains unavailable writing selections when the catalog cannot load", () => {
    render(<AIWritingSection
      availableProviders={providers}
      hasProviders
      models={[]}
      modelsLoading={false}
      modelsError="Catalog unavailable"
      modelsStale={false}
      aiWritingProviderId="provider-1"
      onAIWritingProviderIdChange={vi.fn()}
      aiWritingSettings={{
        referralTone: "professional",
        referralLength: "medium",
        followUpTone: "professional",
        followUpLength: "medium",
        coverLetterTone: "professional",
        coverLetterLength: "medium",
        coverLetterFocus: ["skills"],
        aiWritingModel: "openai/retired-model",
        aiWritingProviderId: "provider-1",
        aiWritingReasoningEffort: "max",
      }}
      onAIWritingSettingsChange={vi.fn()}
    />);

    expect(screen.getByText("Configured: openai/retired-model")).toBeTruthy();
    expect(screen.getByText("max (unavailable)")).toBeTruthy();
    expect(screen.getByText(/configured model is unavailable/i)).toBeTruthy();
  });

  it("retains unavailable resume selections when the catalog cannot load", () => {
    render(<ResumeParserSection
      availableProviders={providers}
      hasProviders
      models={[]}
      modelsLoading={false}
      modelsError="Catalog unavailable"
      modelsStale={false}
      resumeParserProviderId="provider-1"
      onResumeParserProviderIdChange={vi.fn()}
      resumeParserModel="openai/retired-model"
      onResumeParserModelChange={vi.fn()}
      resumeParserReasoningEffort="future_v1"
      onResumeParserReasoningEffortChange={vi.fn()}
    />);

    expect(screen.getByText("Configured: openai/retired-model")).toBeTruthy();
    expect(screen.getByText("future_v1 (unavailable)")).toBeTruthy();
    expect(screen.getByText(/configured model is unavailable/i)).toBeTruthy();
  });
});
