import type { z } from "zod";

import { successSchema } from "@/lib/api/contracts/common";
import {
  localCLIStatusQuerySchema,
  localCLIStatusResponseSchema,
  providerCreateBodySchema,
  providerModelsQuerySchema,
  providerPatchBodySchema,
} from "@/lib/api/contracts/providers";
import { ProviderRouteParamsSchema } from "@/lib/ai/contracts";
import {
  providerCreateResponseSchema,
  providerModelsResponseSchema,
  providerSettingsListSchema,
} from "@/lib/api/contracts/settings";

import {
  apiGet,
  apiCommand,
  apiJsonMutation,
  appendQuery,
  serializePathParam,
  serializeQuery,
} from "../client";

const providerPath = (id: string) => serializePathParam(ProviderRouteParamsSchema, { id });
export type ProviderModelsQueryInput = Partial<z.output<typeof providerModelsQuerySchema>>;
export type LocalCLIStatusProvider = z.output<typeof localCLIStatusQuerySchema>["provider"];

export const getProviders = () => apiGet(
  "/api/providers",
  providerSettingsListSchema,
  "Failed to fetch providers"
);

export const getLocalCLIStatus = (provider: LocalCLIStatusProvider) => apiGet(
  appendQuery(
    "/api/providers/local-cli/status",
    serializeQuery(localCLIStatusQuerySchema, { provider })
  ),
  localCLIStatusResponseSchema,
  "Failed to check local CLI"
);

export const getProviderModels = (
  providerId: string,
  params: ProviderModelsQueryInput = {}
) => apiGet(
  appendQuery(
    `/api/providers/${providerPath(providerId)}/models`,
    serializeQuery(providerModelsQuerySchema, params)
  ),
  providerModelsResponseSchema,
  "Failed to fetch provider models"
);

export const createProvider = (body: z.input<typeof providerCreateBodySchema>) => apiJsonMutation(
  "/api/providers",
  "POST",
  providerCreateBodySchema,
  body,
  providerCreateResponseSchema,
  "Failed to add provider"
);

export const updateProvider = (
  providerId: string,
  body: z.input<typeof providerPatchBodySchema>
) => apiJsonMutation(
  `/api/providers/${providerPath(providerId)}`,
  "PATCH",
  providerPatchBodySchema,
  body,
  successSchema,
  "Failed to update provider"
);

export const updateProviderApiKey = (
  providerId: string,
  body: Pick<z.input<typeof providerPatchBodySchema>, "apiKey">
) => updateProvider(providerId, body);

export const deleteProvider = (providerId: string) => apiCommand(
  `/api/providers/${providerPath(providerId)}`,
  "DELETE",
  successSchema,
  "Failed to delete provider"
);
