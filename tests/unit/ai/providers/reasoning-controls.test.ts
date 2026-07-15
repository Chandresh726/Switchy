import { describe, expect, it } from "vitest";

import { createEffortReasoningControl } from "@/lib/ai/providers/reasoning-controls";

describe("provider reasoning controls", () => {
  it("bounds display metadata without altering provider-native values", () => {
    const control = createEffortReasoningControl([{
      value: "future_v1",
      label: "L".repeat(200),
      description: "D".repeat(700),
    }], "future_v1");

    expect(control).toEqual({
      kind: "effort",
      options: [{
        value: "future_v1",
        label: "L".repeat(120),
        description: "D".repeat(500),
      }],
      defaultValue: "future_v1",
    });
  });
});
