import type { ResolvedModelSnapshot } from "./types";

// OpenCode is a transport for independent upstream accounts. Models within an
// upstream account conservatively share a quota until the provider says otherwise.
export function providerQuotaScope(snapshot: ResolvedModelSnapshot): string {
  return snapshot.backendKind === "opencode_cli"
    ? `${snapshot.providerRecordId}:${snapshot.upstreamProvider ?? snapshot.modelId.split("/")[0]}`
    : snapshot.providerRecordId;
}
