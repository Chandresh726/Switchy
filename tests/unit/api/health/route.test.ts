import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/health/live/route";
import { livenessResponseSchema } from "@/lib/api/contracts/health";

describe("health liveness route", () => {
  it("reports process liveness without depending on runtime readiness", async () => {
    const response = await GET(new Request("http://localhost/api/health/live"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(livenessResponseSchema.parse(await response.json())).toEqual({
      status: "live",
      version: "1.0.13",
      instanceId: null,
    });
  });
});
