import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  object: vi.fn((options) => options),
  array: vi.fn((options) => options),
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  Output: { object: mocks.object, array: mocks.array },
}));

import { generateStructured } from "@/lib/ai/matcher/generation";

describe("generateStructured", () => {
  it("passes cancellation to the AI provider request", async () => {
    mocks.generateText.mockResolvedValue({ output: { score: 90 } });
    const controller = new AbortController();

    await generateStructured({
      model: {} as never,
      schema: z.object({ score: z.number() }),
      instructions: "Score the role",
      prompt: "Role details",
      signal: controller.signal,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal })
    );
  });
});
