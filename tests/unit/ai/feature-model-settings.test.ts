import { describe, expect, it } from "vitest";

import { resolveFeatureModel } from "@/components/settings/feature-model-settings";
import type {
  ProviderSettingsListItem,
  Settings,
} from "@/lib/api/contracts/settings";
import type { ProviderModelsState } from "@/lib/settings/types";

const providers = [
  { id: "first", selectable: true },
  { id: "saved", selectable: false },
] as ProviderSettingsListItem[];
const catalogs: Record<string, ProviderModelsState> = {
  first: {
    models: [
      {
        modelId: "available",
        label: "Available",
        description: "",
        supportsReasoning: true,
        reasoningControl: {
          kind: "effort",
          options: [{ value: "low" }, { value: "high" }],
          defaultValue: "low",
        },
      },
    ],
    loading: false,
    isRefreshing: false,
    isStale: false,
  },
};
const settings = {
  matcher_provider_id: "saved",
  matcher_model: "missing",
  matcher_reasoning_effort: "high",
} as Settings;

describe("feature model selection", () => {
  it("keeps the saved unavailable provider and model visible", () => {
    expect(
      resolveFeatureModel("matcher", {}, settings, providers, catalogs),
    ).toMatchObject({
      providerId: "saved",
      modelId: "missing",
      reasoningEffort: "high",
    });
  });

  it("inherits matcher settings for unconfigured job analysis", () => {
    expect(
      resolveFeatureModel("job_analysis", {}, settings, providers, catalogs),
    ).toMatchObject({
      providerId: "saved",
      modelId: "missing",
      reasoningEffort: "high",
    });
  });

  it("chooses an advertised default when the provider changes and preserves local reasoning edits", () => {
    expect(
      resolveFeatureModel(
        "matcher",
        { providerId: "first" },
        settings,
        providers,
        catalogs,
      ),
    ).toMatchObject({
      providerId: "first",
      modelId: "available",
      reasoningEffort: "low",
      localProviderEdited: true,
    });
    expect(
      resolveFeatureModel(
        "matcher",
        { providerId: "first", modelId: "available", reasoningEffort: "high" },
        settings,
        providers,
        catalogs,
      ),
    ).toMatchObject({
      reasoningEffort: "high",
      localModelEdited: true,
    });
  });

  it("does not configure an unselectable provider when nothing has been saved", () => {
    expect(
      resolveFeatureModel(
        "resume_parser",
        {},
        undefined,
        [providers[1]],
        catalogs,
      ),
    ).toMatchObject({
      providerId: "",
      modelId: "",
      reasoningEffort: "",
    });
  });
});
