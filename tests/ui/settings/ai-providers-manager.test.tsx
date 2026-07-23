import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AIProvidersManager } from "@/components/settings/ai-providers-manager";

function props() {
  return {
    providers: [
      {
        id: "builtin:codex-cli",
        provider: "codex_cli",
        kind: "local_cli" as const,
        isActive: true,
        hasApiKey: false,
        selectable: true,
        connectionStatus: "ready" as const,
        cliVersion: "1.2.3",
        statusMessage: "2 text models available.",
        createdAt: null,
        updatedAt: null,
      },
      {
        id: "builtin:opencode-cli",
        provider: "opencode_cli",
        kind: "local_cli" as const,
        isActive: true,
        hasApiKey: false,
        selectable: false,
        connectionStatus: "not_authenticated" as const,
        statusMessage: "OpenCode has no authenticated providers.",
        createdAt: null,
        updatedAt: null,
      },
    ],
    onAddProvider: vi.fn(),
    onDeleteProvider: vi.fn(),
    onUpdateProvider: vi.fn(),
    onRefreshProviderModels: vi.fn(),
    codexExecutablePath: "",
    openCodeExecutablePath: "",
    onSaveExecutablePaths: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AIProvidersManager local CLI providers", () => {
  it("limits a pending CLI check skeleton to that provider's status", () => {
    const input = props();
    const pendingProvider = {
      ...input.providers[0],
      selectable: false,
      connectionStatus: undefined,
      cliVersion: undefined,
      statusMessage: undefined,
    };

    render(<AIProvidersManager {...input} providers={[pendingProvider]} />);

    expect(screen.getByText("Codex CLI")).toBeTruthy();
    expect(screen.getByLabelText("Codex CLI status loading")).toBeTruthy();
    expect(screen.queryByText("checking")).toBeNull();
    expect(screen.getByRole("button", { name: "Edit executable path" })).toBeTruthy();
  });

  it("shows configured CLI providers with working delete actions", () => {
    const input = props();
    render(<AIProvidersManager {...input} />);

    expect(screen.getByText("Manage API-key, custom API, and local CLI providers in one place.")).toBeTruthy();
    expect(screen.getByText("Codex CLI")).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(screen.queryByText("Local CLI")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Delete provider" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    expect(screen.queryByRole("button", { name: /test ai features/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Refresh models" })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: "Delete provider" })[0]);
    expect(screen.getByText("Delete Codex CLI?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(input.onDeleteProvider).toHaveBeenCalledWith("builtin:codex-cli");
  });

  it("keeps API provider status colorful on the right without a row icon or check action", () => {
    const input = props();
    const apiProvider = {
      id: "provider-cerebras",
      provider: "cerebras",
      kind: "api_key" as const,
      isActive: true,
      hasApiKey: true,
      selectable: true,
      createdAt: null,
      updatedAt: null,
    };
    const { container } = render(
      <AIProvidersManager {...input} providers={[apiProvider]} />
    );

    expect(screen.getByText(/connected/i).className).toContain("text-green-400");
    expect(screen.queryByText("API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    expect(container.querySelectorAll("svg.lucide-key")).toHaveLength(1);
    const addButton = screen.getByRole("button", { name: "Add Another Provider" });
    expect(addButton.className).toContain("w-full");
    expect(addButton.className).toContain("text-emerald-400");
  });

  it("auto-saves an executable override", async () => {
    vi.useFakeTimers();
    const input = props();
    render(<AIProvidersManager {...input} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit executable path" })[0]);
    fireEvent.change(screen.getByLabelText("Executable path"), {
      target: { value: "/opt/codex" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(500));

    expect(input.onSaveExecutablePaths).toHaveBeenCalledWith({
      codex: "/opt/codex",
      opencode: "",
    });
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    vi.useRealTimers();
  });

  it("does not offer already-configured CLI providers in the add-provider menu", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const input = props();
    render(<AIProvidersManager {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Another Provider" }));
    fireEvent.click(screen.getByLabelText("Provider"));
    expect(screen.queryByRole("option", { name: "Codex CLI · Local CLI" })).toBeNull();
    expect(screen.queryByRole("option", { name: "OpenCode · Local CLI" })).toBeNull();
  });

  it("offers an unconfigured CLI provider and submits it for verification", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const input = props();
    render(<AIProvidersManager {...input} providers={input.providers.slice(0, 1)} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Another Provider" }));
    fireEvent.click(screen.getByLabelText("Provider"));
    fireEvent.click(screen.getByRole("option", { name: "OpenCode · Local CLI" }));

    expect(screen.getByText(/verify that the CLI is installed/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add Provider" }));
    expect(input.onAddProvider).toHaveBeenCalledWith({
      provider: "opencode_cli",
      apiKey: undefined,
    });
  });

  it("keeps Custom available and submits the complete connection form", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const input = props();
    render(<AIProvidersManager {...input} providers={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Provider" }));
    fireEvent.click(screen.getByLabelText("Provider"));
    fireEvent.click(screen.getByRole("option", { name: "Custom · API endpoint" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "CLI Proxy API" } });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "http://127.0.0.1:8317/v1" },
    });
    fireEvent.change(screen.getByLabelText("API key or token (optional)"), {
      target: { value: "proxy-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add header" }));
    const headerNameInput = screen.getByLabelText("Header 1 name");
    headerNameInput.focus();
    fireEvent.change(headerNameInput, {
      target: { value: "X-Route" },
    });
    expect(document.activeElement).toBe(headerNameInput);
    fireEvent.change(screen.getByLabelText("Header 1 value"), {
      target: { value: "codex" },
    });
    fireEvent.change(screen.getByLabelText("Manual model IDs (optional)"), {
      target: { value: "manual-one\nmanual-two" },
    });
    fireEvent.change(screen.getByLabelText("Reasoning levels (optional)"), {
      target: { value: "low, medium, high, xhigh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Provider" }));

    expect(input.onAddProvider).toHaveBeenCalledWith({
      provider: "custom",
      displayName: "CLI Proxy API",
      apiFormat: "openai_chat_completions",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: "proxy-secret",
      headers: [{ name: "X-Route", value: "codex" }],
      manualModelIds: ["manual-one", "manual-two"],
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
    });
  });

  it("renders multiple named custom providers and preserves masked headers while editing", async () => {
    const input = props();
    const customProviders = ["Primary proxy", "Backup proxy"].map((displayName, index) => ({
      id: `custom-${index}`,
      provider: "custom",
      kind: "custom" as const,
      displayName,
      apiFormat: "anthropic_messages" as const,
      baseUrl: `http://127.0.0.1:${8317 + index}/v1`,
      headerNames: ["Authorization"],
      manualModelIds: ["claude-proxy"],
      reasoningEfforts: ["low", "medium", "high"],
      isActive: true,
      hasApiKey: true,
      selectable: true,
      createdAt: null,
      updatedAt: null,
    }));
    render(<AIProvidersManager {...input} providers={customProviders} />);

    expect(screen.getByText("Primary proxy")).toBeTruthy();
    expect(screen.getByText("Backup proxy")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add Another Provider" })).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit connection" })[0]);
    expect(screen.getByLabelText("Header 1 value").getAttribute("placeholder")).toBe("Stored value");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed proxy" } });
    fireEvent.click(screen.getByRole("button", { name: "Update connection" }));

    expect(input.onUpdateProvider).toHaveBeenCalledWith("custom-0", {
      displayName: "Renamed proxy",
      apiFormat: "anthropic_messages",
      baseUrl: "http://127.0.0.1:8317/v1",
      apiKey: undefined,
      headers: [{ name: "Authorization" }],
      manualModelIds: ["claude-proxy"],
      reasoningEfforts: ["low", "medium", "high"],
    });
  });

});
