import { fireEvent, render, screen } from "@testing-library/react";
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
    onCheckProvider: vi.fn(),
    codexExecutablePath: "",
    openCodeExecutablePath: "",
    onSaveExecutablePaths: vi.fn(),
  };
}

describe("AIProvidersManager local CLI providers", () => {
  it("shows permanent CLI status cards without edit or delete controls", () => {
    render(<AIProvidersManager {...props()} />);

    expect(screen.getByText("Local CLI providers")).toBeTruthy();
    expect(screen.getByText("Codex CLI")).toBeTruthy();
    expect(screen.getByText("OpenCode")).toBeTruthy();
    expect(screen.getByText("v1.2.3")).toBeTruthy();
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryByTitle("Edit")).toBeNull();
  });

  it("checks status and saves Advanced executable overrides", async () => {
    const input = props();
    render(<AIProvidersManager {...input} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Check again" })[0]);
    expect(input.onCheckProvider).toHaveBeenCalledWith("builtin:codex-cli");

    fireEvent.click(screen.getByRole("button", { name: "Advanced executable paths" }));
    fireEvent.change(screen.getByLabelText("Codex CLI executable"), {
      target: { value: "/opt/codex" },
    });
    fireEvent.change(screen.getByLabelText("OpenCode executable"), {
      target: { value: "/opt/opencode" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save paths" }));

    expect(input.onSaveExecutablePaths).toHaveBeenCalledWith({
      codex: "/opt/codex",
      opencode: "/opt/opencode",
    });
  });
});
