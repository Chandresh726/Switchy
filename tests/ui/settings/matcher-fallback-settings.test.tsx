import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/settings/model-combobox", () => ({
  ModelCombobox: ({ models, value, onValueChange, ariaLabel }: {
    models: Array<{ modelId: string; label: string }>;
    value: string;
    onValueChange: (id: string) => void;
    ariaLabel: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={(event) => onValueChange(event.target.value)}>
      {models.map((model) => <option key={model.modelId} value={model.modelId}>{model.label}</option>)}
    </select>
  ),
}));

import { MatcherFallbackSettings, type FallbackSettings } from "@/components/settings/matcher-fallback-settings";

const settings: FallbackSettings = {
  job_analysis_fallback_enabled: "false",
  job_analysis_fallback_provider_id: "provider-1",
  job_analysis_fallback_model: "",
  job_analysis_fallback_reasoning_effort: "",
  matcher_fallback_enabled: "false",
  matcher_fallback_provider_id: "provider-1",
  matcher_fallback_model: "",
  matcher_fallback_reasoning_effort: "",
};
const providers = [{ id: "provider-1", provider: "openai", name: "OpenAI" }];
const modelsByProvider = { "provider-1": { loading: false, isRefreshing: false, isStale: false, models: [{
  modelId: "backup-model", label: "Backup", description: "", supportsReasoning: true,
  reasoningControl: { kind: "effort" as const, options: [{ value: "low" }], defaultValue: "low" },
}] } };

describe("matching fallback controls", () => {
  it("defaults unconfigured provider selectors to Disabled", () => {
    render(<MatcherFallbackSettings settings={{ ...settings, job_analysis_fallback_provider_id: "", matcher_fallback_provider_id: "" }}
      availableProviders={providers} modelsByProvider={modelsByProvider} onChange={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Job analysis fallback provider" }).textContent).toContain("Disabled");
    expect(screen.getByRole("combobox", { name: "Final match fallback provider" }).textContent).toContain("Disabled");
  });

  it("clears the provider, model, and reasoning when Disabled is chosen", () => {
    Element.prototype.scrollIntoView = vi.fn();
    const onChange = vi.fn();
    render(<MatcherFallbackSettings settings={{ ...settings, matcher_fallback_enabled: "true", matcher_fallback_model: "backup-model", matcher_fallback_reasoning_effort: "low" }}
      availableProviders={providers} modelsByProvider={modelsByProvider} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox", { name: "Final match fallback provider" }));
    fireEvent.click(screen.getByRole("option", { name: "Disabled" }));
    expect(onChange).toHaveBeenCalledWith({ matcher_fallback_provider_id: "", matcher_fallback_enabled: "false", matcher_fallback_model: "", matcher_fallback_reasoning_effort: "" });
  });

  it("enables each fallback by selecting a model, without checkboxes or descriptions", () => {
    const onChange = vi.fn();
    render(<MatcherFallbackSettings settings={settings} availableProviders={providers} modelsByProvider={modelsByProvider} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Job analysis fallback model" }), { target: { value: "backup-model" } });
    expect(onChange).toHaveBeenCalledWith({ job_analysis_fallback_model: "backup-model", job_analysis_fallback_enabled: "true", job_analysis_fallback_reasoning_effort: "low" });
    fireEvent.change(screen.getByRole("combobox", { name: "Final match fallback model" }), { target: { value: "backup-model" } });
    expect(onChange).toHaveBeenCalledWith({ matcher_fallback_model: "backup-model", matcher_fallback_enabled: "true", matcher_fallback_reasoning_effort: "low" });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByText(/primary is unavailable|provider balance/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("disables the fallback and clears its reasoning setting when None is selected", () => {
    const onChange = vi.fn();
    render(<MatcherFallbackSettings settings={{ ...settings, matcher_fallback_enabled: "true", matcher_fallback_model: "backup-model", matcher_fallback_reasoning_effort: "low" }}
      availableProviders={providers} modelsByProvider={{}} onChange={onChange} />);
    const selector = screen.getByRole("combobox", { name: "Final match fallback model" });
    const none = screen.getAllByRole("option", { name: "None" })[1] as HTMLOptionElement;
    fireEvent.change(selector, { target: { value: none.value } });
    expect(onChange).toHaveBeenCalledWith({ matcher_fallback_model: "", matcher_fallback_enabled: "false", matcher_fallback_reasoning_effort: "" });
  });

  it("keeps previously disabled models unselected until the user chooses one", () => {
    render(<MatcherFallbackSettings settings={{ ...settings, matcher_fallback_model: "backup-model" }}
      availableProviders={providers} modelsByProvider={modelsByProvider} onChange={vi.fn()} />);
    expect((screen.getByRole("combobox", { name: "Final match fallback model" }) as HTMLSelectElement).selectedOptions[0].text).toBe("None");
  });
});
