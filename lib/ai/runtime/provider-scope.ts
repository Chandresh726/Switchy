import type { ResolvedModelSnapshot } from "./types";

// OpenCode transports independent upstream accounts. Share concurrency within an
// account, but allow a different model to probe a model-specific rate limit.
export function providerQuotaScope(snapshot: ResolvedModelSnapshot): string {
  return snapshot.backendKind === "opencode_cli"
    ? `${snapshot.providerRecordId}:${snapshot.upstreamProvider ?? snapshot.modelId.split("/")[0]}`
    : snapshot.providerRecordId;
}

export function providerModelScope(accountScope: string, modelId: string): string {
  return `${accountScope}:model:${encodeURIComponent(modelId)}`;
}
