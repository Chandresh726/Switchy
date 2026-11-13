import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/model-combobox", () => ({
  ModelCombobox: ({ onValueChange }: { onValueChange: (id: string) => void }) => (
    <button onClick={() => onValueChange("backup-model")}>Choose backup model</button>
  ),
}));

import { MatcherFallbackSettings, type FallbackSettings } from "@/components/settings/matcher-fallback-settings";

const settings: FallbackSettings = {
  job_analysis_fallback_enabled: "false",
  job_analysis_fallback_provider_id: "provider-1",
  job_analysis_fallback_model: "",
  job_analysis_fallback_reasoning_effort: "",
  matcher_fallback_enabled: "false",
  matcher_fallback_provider_id: "",
  matcher_fallback_model: "",
  matcher_fallback_reasoning_effort: "",
};

const providers = [{ id: "provider-1", provider: "openai", name: "OpenAI" }];

describe("matching fallback controls", () => {
  it("updates each stage through the parent autosave flow without a separate save button", () => {
    const onChange = vi.fn();
    render(<MatcherFallbackSettings settings={settings} availableProviders={providers} modelsByProvider={{}} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Job analysis fallback" }));
    expect(onChange).toHaveBeenCalledWith({ job_analysis_fallback_enabled: "true" });
    fireEvent.click(screen.getByRole("checkbox", { name: "Final match fallback" }));
    expect(onChange).toHaveBeenCalledWith({ matcher_fallback_enabled: "true" });
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(screen.queryByText("Matching fallbacks")).toBeNull();
  });

  it("uses the selected model's advertised reasoning default", () => {
    const onChange = vi.fn();
    render(<MatcherFallbackSettings settings={settings} availableProviders={providers} onChange={onChange}
      modelsByProvider={{ "provider-1": { loading: false, isRefreshing: false, isStale: false, models: [{
        modelId: "backup-model", label: "Backup", description: "", supportsReasoning: true,
        reasoningControl: { kind: "effort", options: [{ value: "low" }], defaultValue: "low" },
      }] } }} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose backup model" })[0]);
    expect(onChange).toHaveBeenCalledWith({ job_analysis_fallback_model: "backup-model", job_analysis_fallback_reasoning_effort: "low" });
  });
});
