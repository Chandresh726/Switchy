import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executable: "/fake/codex",
  readAccount: vi.fn(),
  listCodexModels: vi.fn(),
  codexVersion: vi.fn(),
  listOpenCodeModels: vi.fn(),
  openCodeVersion: vi.fn(),
  setCodexReasoning: vi.fn(),
  setOpenCodeReasoning: vi.fn(),
  loadStoredCatalog: vi.fn(),
  saveStoredCatalog: vi.fn(),
  validateStoredCatalog: vi.fn(),
  deleteStoredCatalog: vi.fn(),
  retireCodex: vi.fn(),
  retireOpenCode: vi.fn(),
  readConnectedOpenCodeProviders: vi.fn(),
  lastConnectedOpenCodeProviders: vi.fn(),
}));

vi.mock("@/lib/ai/local-cli/catalog-cache", () => ({
  loadStoredLocalCLICatalog: mocks.loadStoredCatalog,
  saveStoredLocalCLICatalog: mocks.saveStoredCatalog,
  deleteStoredLocalCLICatalog: mocks.deleteStoredCatalog,
  validateLocalCLIModelCatalog: mocks.validateStoredCatalog,
}));

vi.mock("@/lib/ai/local-cli/executable", () => ({
  resolveCLIExecutable: vi.fn(async () => mocks.executable),
}));

vi.mock("@/lib/ai/local-cli/codex-backend", () => ({
  CodexCLIBackend: class {
    readAccount = mocks.readAccount;
    listModels = mocks.listCodexModels;
    getVersion = mocks.codexVersion;
    setModelReasoningEfforts = mocks.setCodexReasoning;
    retire = mocks.retireCodex;
  },
}));

vi.mock("@/lib/ai/local-cli/opencode-backend", () => ({
  OpenCodeCLIBackend: class {
    listModels = mocks.listOpenCodeModels;
    getVersion = mocks.openCodeVersion;
    hasConnectedProviders = () => mocks.lastConnectedOpenCodeProviders().length > 0;
    readConnectedProviderIds = mocks.readConnectedOpenCodeProviders;
    getLastConnectedProviderIds = mocks.lastConnectedOpenCodeProviders;
    setModelReasoningEfforts = mocks.setOpenCodeReasoning;
    retire = mocks.retireOpenCode;
  },
}));

import {
  clearLocalCLICaches,
  getLocalCLIModels,
  getLocalCLIExecutionTarget,
  getLocalCLIStatus,
  resetLocalCLIProvider,
  shutdownLocalCLIBackends,
} from "@/lib/ai/local-cli/service";

describe("local CLI connection status", () => {
  beforeEach(() => {
    clearLocalCLICaches();
    vi.clearAllMocks();
    mocks.executable = "/fake/codex";
    mocks.codexVersion.mockResolvedValue("1.0.0");
    mocks.openCodeVersion.mockResolvedValue("2.0.0");
    mocks.readAccount.mockResolvedValue({ authenticated: true });
    mocks.listCodexModels.mockResolvedValue([{ modelId: "gpt" }]);
    mocks.listOpenCodeModels.mockResolvedValue([{ modelId: "openai/gpt" }]);
    mocks.loadStoredCatalog.mockResolvedValue(null);
    mocks.saveStoredCatalog.mockResolvedValue(undefined);
    mocks.validateStoredCatalog.mockImplementation((models) => models);
    mocks.deleteStoredCatalog.mockResolvedValue(undefined);
    mocks.readConnectedOpenCodeProviders.mockResolvedValue(["openai"]);
    mocks.lastConnectedOpenCodeProviders.mockReturnValue(["openai"]);
  });

  it("reports installation, authentication, and model availability without generation", async () => {
    mocks.executable = "";
    await expect(getLocalCLIStatus("codex_cli", { forceRefresh: true })).resolves.toMatchObject({
      status: "not_installed",
      selectable: false,
    });

    mocks.executable = "/fake/codex";
    mocks.readAccount.mockResolvedValueOnce({ authenticated: false });
    await expect(getLocalCLIStatus("codex_cli", { forceRefresh: true })).resolves.toMatchObject({
      status: "not_authenticated",
      selectable: false,
    });

    mocks.listCodexModels.mockResolvedValueOnce([]);
    await expect(getLocalCLIStatus("codex_cli", { forceRefresh: true })).resolves.toMatchObject({
      status: "no_models",
      selectable: false,
    });

    await expect(getLocalCLIStatus("opencode_cli", { forceRefresh: true })).resolves.toMatchObject({
      status: "ready",
      selectable: true,
      cliVersion: "2.0.0",
    });
  });

  it("uses the 30-second status cache unless a forced check is requested", async () => {
    await getLocalCLIStatus("codex_cli");
    await getLocalCLIStatus("codex_cli");
    expect(mocks.codexVersion).toHaveBeenCalledTimes(1);
    expect(mocks.listCodexModels).toHaveBeenCalledTimes(1);

    await getLocalCLIStatus("codex_cli", { forceRefresh: true });
    expect(mocks.codexVersion).toHaveBeenCalledTimes(2);
    expect(mocks.listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("reports required-protocol failures as incompatible", async () => {
    mocks.readAccount.mockRejectedValueOnce(new Error("Codex CLI protocol is incompatible"));

    await expect(getLocalCLIStatus("codex_cli", { forceRefresh: true })).resolves.toMatchObject({
      status: "incompatible",
      selectable: false,
    });
  });

  it("reports OpenCode with no connected provider as not authenticated", async () => {
    mocks.readConnectedOpenCodeProviders.mockResolvedValueOnce([]);

    await expect(getLocalCLIStatus("opencode_cli", { forceRefresh: true })).resolves.toMatchObject({
      status: "not_authenticated",
      selectable: false,
    });
    expect(mocks.listOpenCodeModels).not.toHaveBeenCalled();
  });

  it("does not let a durable OpenCode catalog outlive disconnected authentication", async () => {
    mocks.loadStoredCatalog.mockResolvedValue({
      fetchedAt: Date.now(),
      models: [{
        modelId: "openai/gpt",
        label: "GPT",
        description: "",
        supportsReasoning: false,
        upstreamProvider: "openai",
      }],
    });
    await expect(getLocalCLIStatus("opencode_cli")).resolves.toMatchObject({ status: "ready" });

    clearLocalCLICaches("opencode_cli");
    mocks.readConnectedOpenCodeProviders.mockResolvedValueOnce([]);

    await expect(getLocalCLIStatus("opencode_cli")).resolves.toMatchObject({
      status: "not_authenticated",
      selectable: false,
    });
  });

  it("filters cached OpenCode models by the live connected-provider set", async () => {
    mocks.loadStoredCatalog.mockResolvedValue({
      fetchedAt: Date.now(),
      models: [
        {
          modelId: "openai/gpt",
          label: "GPT",
          description: "",
          supportsReasoning: false,
          upstreamProvider: "openai",
        },
        {
          modelId: "disconnected/model",
          label: "Unavailable",
          description: "",
          supportsReasoning: false,
          upstreamProvider: "disconnected",
        },
      ],
    });

    await expect(getLocalCLIModels("opencode_cli")).resolves.toEqual([
      expect.objectContaining({ modelId: "openai/gpt" }),
    ]);
  });

  it("caches model catalogs independently and allows an explicit refresh", async () => {
    await getLocalCLIModels("codex_cli");
    await getLocalCLIModels("codex_cli");
    expect(mocks.listCodexModels).toHaveBeenCalledTimes(1);

    await getLocalCLIModels("codex_cli", { forceRefresh: true });
    expect(mocks.listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("validates a discovered catalog before caching it in memory", async () => {
    mocks.validateStoredCatalog.mockImplementationOnce(() => {
      throw new Error("Invalid provider catalog metadata");
    });

    await expect(getLocalCLIModels("codex_cli", { forceRefresh: true }))
      .rejects.toThrow("Invalid provider catalog metadata");
    await expect(getLocalCLIModels("codex_cli")).resolves.toEqual([{ modelId: "gpt" }]);

    expect(mocks.listCodexModels).toHaveBeenCalledTimes(2);
    expect(mocks.saveStoredCatalog).toHaveBeenCalledTimes(1);
  });

  it("restores reasoning capabilities from durable cache without execution-time discovery", async () => {
    mocks.loadStoredCatalog.mockResolvedValue({
      fetchedAt: 1,
      models: [{
        modelId: "gpt",
        label: "GPT",
        description: "",
        supportsReasoning: true,
        supportedReasoningEfforts: ["low", "high"],
        defaultReasoningEffort: "low",
      }],
    });

    await expect(getLocalCLIExecutionTarget("codex_cli", "gpt")).resolves.toMatchObject({
      cliVersion: "1.0.0",
    });
    expect(mocks.setCodexReasoning).toHaveBeenCalledWith("gpt", ["low", "high"]);
    expect(mocks.listCodexModels).not.toHaveBeenCalled();
  });

  it("fails clearly instead of discovering or replacing a model during execution", async () => {
    await expect(getLocalCLIExecutionTarget("opencode_cli", "openai/missing"))
      .rejects.toMatchObject({ type: "invalid_model" });
    expect(mocks.listOpenCodeModels).not.toHaveBeenCalled();
  });

  it("retires the old process and removes durable capabilities after a path change", async () => {
    await getLocalCLIModels("codex_cli", { forceRefresh: true });

    await resetLocalCLIProvider("codex_cli");

    expect(mocks.retireCodex).toHaveBeenCalledOnce();
    expect(mocks.deleteStoredCatalog).toHaveBeenCalledWith("codex_cli");
    mocks.executable = "/fake/new-codex";
    await getLocalCLIModels("codex_cli", { forceRefresh: true });
    expect(mocks.listCodexModels).toHaveBeenCalledTimes(2);
  });

  it("retires supervised processes when a one-shot caller shuts down", async () => {
    await getLocalCLIModels("codex_cli", { forceRefresh: true });
    await getLocalCLIModels("opencode_cli", { forceRefresh: true });

    shutdownLocalCLIBackends();

    expect(mocks.retireCodex).toHaveBeenCalled();
    expect(mocks.retireOpenCode).toHaveBeenCalled();
  });
});
