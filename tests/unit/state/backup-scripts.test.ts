import { describe, expect, it } from "vitest";

import { stateCliArguments } from "@/lib/state/cli-arguments";

describe("local state command contracts", () => {
  it("accepts pnpm's documented argument separator", () => {
    expect(stateCliArguments(["--", "--environment", "production"])).toEqual([
      "--environment",
      "production",
    ]);
    expect(stateCliArguments(["--from", "/snapshot"])).toEqual([
      "--from",
      "/snapshot",
    ]);
  });

});
