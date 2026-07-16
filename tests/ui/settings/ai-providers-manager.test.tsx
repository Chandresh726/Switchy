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
    onUpdateProviderApiKey: vi.fn(),
    onRefreshProviderModels: vi.fn(),
    codexExecutablePath: "",
    openCodeExecutablePath: "",
    onSaveExecutablePaths: vi.fn().mockResolvedValue(undefined),
  };
}

describe("AIProvidersManager local CLI providers", () => {
  it("shows permanent CLI providers without add or delete actions", () => {
    render(<AIProvidersManager {...props()} />);

    expect(screen.getByText("Manage API-key and local CLI providers in one place.")).toBeTruthy();
    expect(screen.getByText("Codex CLI")).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(screen.queryByText("Local CLI")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete provider" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
    expect(screen.queryByRole("button", { name: /test ai features/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Refresh models" })).toHaveLength(2);
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

  it("does not offer permanent CLI providers in the add-provider menu", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const input = props();
    render(<AIProvidersManager {...input} />);

    fireEvent.click(screen.getByRole("button", { name: "Add Another Provider" }));
    fireEvent.click(screen.getByLabelText("Provider"));
    expect(screen.queryByRole("option", { name: "Codex CLI · Local CLI" })).toBeNull();
    expect(screen.queryByRole("option", { name: "OpenCode · Local CLI" })).toBeNull();
  });

});
