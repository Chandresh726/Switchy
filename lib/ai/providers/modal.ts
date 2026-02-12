import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { BaseProvider } from "./base-provider";
import type { AIProvider, ModelConfig, ProviderConfig } from "./types";

const MODAL_BASE_URL = "https://api.us-west-2.modal.direct/v1";

export class ModalProvider extends BaseProvider {
  readonly id: AIProvider = "modal";
  readonly name = "Modal (GLM-5)";
  readonly requiresApiKey = true;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  supportsReasoningEffort(_modelId: string): boolean {
    return true;
  }

  protected createLanguageModel(
    config: ModelConfig,
    providerConfig: ProviderConfig
  ): LanguageModel {
    const modal = createOpenAICompatible({
      name: "modal",
      baseURL: MODAL_BASE_URL,
      apiKey: providerConfig.apiKey,
    });

    return modal(config.modelId);
  }
}

export const modalProvider = new ModalProvider();
