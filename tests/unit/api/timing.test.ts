import { expect, it } from "vitest";

import { queryMetricsLogger, withApiTiming } from "@/lib/api/timing";

it("keeps query counts isolated across concurrent requests", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = withApiTiming(async () => {
    queryMetricsLogger.logQuery();
    await gate;
    queryMetricsLogger.logQuery();
    return Response.json({ ok: true });
  });
  const second = await withApiTiming(async () => {
    queryMetricsLogger.logQuery();
    return Response.json({ ok: true });
  });
  release();
  expect(second.headers.get("X-DB-Query-Count")).toBe("1");
  const response = await first;
  expect(response.headers.get("X-DB-Query-Count")).toBe("2");
  expect(response.headers.get("Server-Timing")).toMatch(/app;dur=\d+\.\d+/);
});
