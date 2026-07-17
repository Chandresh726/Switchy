import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAIContentWorkspace } from "@/lib/ai/writing/workspace/use-ai-content-workspace";

const mocks = vi.hoisted(() => ({
  getAIContent: vi.fn(),
  openAIContentStream: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@/lib/api/clients/ai", () => ({
  consumeAIContentStream: vi.fn(),
  getAIContent: mocks.getAIContent,
  openAIContentStream: mocks.openAIContentStream,
  recordAIVariantSignal: vi.fn(),
  saveAIContent: vi.fn(),
}));

describe("useAIContentWorkspace stream lifecycle", () => {
  beforeEach(() => {
    mocks.getAIContent.mockReset();
    mocks.openAIContentStream.mockReset();
  });

  it("aborts an active generation stream when the workspace unmounts", async () => {
    let requestSignal: AbortSignal | undefined;
    mocks.getAIContent.mockResolvedValue({ exists: false, content: null });
    mocks.openAIContentStream.mockImplementation(
      (_input: unknown, signal: AbortSignal) => {
        requestSignal = signal;
        return new Promise<Response>(() => undefined);
      }
    );

    const { unmount } = renderHook(() =>
      useAIContentWorkspace({ contentType: "referral", jobId: 42 })
    );

    await waitFor(() => expect(mocks.openAIContentStream).toHaveBeenCalledTimes(1));
    expect(requestSignal?.aborted).toBe(false);

    unmount();

    expect(requestSignal?.aborted).toBe(true);
  });
});
