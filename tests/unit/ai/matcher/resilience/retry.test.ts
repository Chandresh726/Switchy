import { describe, expect, it, vi } from "vitest";

import { retryWithBackoff } from "@/lib/ai/matcher/resilience/retry";
import { AIProviderError } from "@/lib/ai/shared/errors";

describe("retryWithBackoff", () => {
  it("stops retry backoff immediately when matching is cancelled", async () => {
    const controller = new AbortController();
    const operation = vi.fn(async () => {
      throw new AIProviderError("provider unavailable");
    });
    const retrying = retryWithBackoff(operation, {
      maxRetries: 3,
      baseDelay: 60_000,
      maxDelay: 60_000,
      signal: controller.signal,
    });
    const reason = new DOMException("lease lost", "AbortError");
    const rejection = expect(retrying).rejects.toBe(reason);
    await vi.waitFor(() => expect(operation).toHaveBeenCalledOnce());

    controller.abort(reason);

    await rejection;
    expect(operation).toHaveBeenCalledOnce();
  });
});
