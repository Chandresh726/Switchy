import { useState, type ReactNode } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsAutosave } from "@/components/settings/use-settings-autosave";

const mocks = vi.hoisted(() => ({
  patchSettings: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("@/lib/api/clients/settings", () => ({
  patchSettings: mocks.patchSettings,
}));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));

function setup() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return renderHook(
    () => {
      const [edits, setEdits] = useState<{ model?: string }>({});
      useSettingsAutosave({
        edits,
        setEdits,
        updates: { matcher_model: edits.model },
        enabled: edits.model !== undefined,
        delay: 400,
        errorMessage: "Save failed",
      });
      return { edits, setEdits };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe("settings autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it("debounces edits and preserves newer edits while an earlier save completes", async () => {
    let finish: (data: object) => void = () => {};
    mocks.patchSettings
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({ matcher_model: "third" });
    const { result } = setup();
    act(() => result.current.setEdits({ model: "first" }));
    await advance(300);
    act(() => result.current.setEdits({ model: "second" }));
    await advance(399);
    expect(mocks.patchSettings).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.patchSettings).toHaveBeenCalledExactlyOnceWith({
      matcher_model: "second",
    });
    act(() => result.current.setEdits({ model: "third" }));
    await advance(1_000);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ matcher_model: "second" });
    });
    await advance(1);
    expect(result.current.edits).toEqual({ model: "third" });
    await advance(500);
    expect(mocks.patchSettings).toHaveBeenLastCalledWith({
      matcher_model: "third",
    });
    expect(result.current.edits).toEqual({});
  });

  it("does not loop on a rejected snapshot and allows explicit retry", async () => {
    mocks.patchSettings
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ matcher_model: "selected" });
    const { result } = setup();
    act(() => result.current.setEdits({ model: "selected" }));
    await advance(500);
    await advance(5_000);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(1);
    expect(result.current.edits).toEqual({ model: "selected" });
    const options = mocks.toastError.mock.calls[0][1] as {
      action: { onClick: () => void };
    };
    await act(async () => {
      options.action.onClick();
    });
    await advance(1);
    expect(mocks.patchSettings).toHaveBeenCalledTimes(2);
    expect(result.current.edits).toEqual({});
  });

  it("cancels a pending debounce on unmount", async () => {
    const { result, unmount } = setup();
    act(() => result.current.setEdits({ model: "selected" }));
    unmount();
    await advance(1_000);
    expect(mocks.patchSettings).not.toHaveBeenCalled();
  });
});
