import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLIExecutableField } from "@/components/settings/cli-executable-field";

afterEach(() => vi.useRealTimers());

describe("CLI executable autosave", () => {
  it("retains edits made while the previous path is being saved", async () => {
    vi.useFakeTimers();
    let finish: (() => void) | undefined;
    const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    render(<CLIExecutableField id="path" command="codex" value="" onSave={save} />);
    fireEvent.change(screen.getByLabelText("Executable path"), { target: { value: "/first/codex" } });
    await act(async () => vi.advanceTimersByTimeAsync(500));
    fireEvent.change(screen.getByLabelText("Executable path"), { target: { value: "/second/codex" } });
    await act(async () => { finish?.(); });
    expect((screen.getByLabelText("Executable path") as HTMLInputElement).value).toBe("/second/codex");
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(save.mock.calls.map(([value]) => value)).toEqual(["/first/codex", "/second/codex"]);
  });

  it("reflects server-side path changes without writing the old value back", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<CLIExecutableField id="path" command="codex" value="/old/codex" onSave={save} />);
    rerender(<CLIExecutableField id="path" command="codex" value="" onSave={save} />);
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect((screen.getByLabelText("Executable path") as HTMLInputElement).value).toBe("");
    expect(save).not.toHaveBeenCalled();
  });
});
