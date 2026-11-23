import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";

import { aiWorkItems } from "@/lib/db/schema";
import { createSqliteTestHarness } from "@test/helpers/sqlite-test-database";

const harness = createSqliteTestHarness("switchy-lifecycle-activity-");
vi.mock("@/lib/jobs/scheduler", () => ({ getSchedulerStatus: async () => ({ isRunning: false }) }));
vi.mock("@/lib/runtime/update-maintenance", () => ({ hasRecentMutation: () => false }));
afterEach(() => {
  vi.doUnmock("@/lib/db");
  vi.resetModules();
});

it("waits for durable work to finish before permitting an update", async () => {
  const { database } = harness.createDatabase();
  vi.doMock("@/lib/db", () => ({ db: database }));
  const { GET } = await import("@/app/api/lifecycle/activity/route");
  const request = new Request("http://localhost/api/lifecycle/activity");
  expect(await (await GET(request)).json()).toEqual({ idle: true });
  database.insert(aiWorkItems).values({ id: "queued", workType: "match_jobs", payloadJson: "{}", status: "queued" }).run();
  expect(await (await GET(request)).json()).toEqual({ idle: false });
  database.update(aiWorkItems).set({ status: "running" }).where(eq(aiWorkItems.id, "queued")).run();
  expect(await (await GET(request)).json()).toEqual({ idle: false });
  database.update(aiWorkItems).set({ status: "completed" }).where(eq(aiWorkItems.id, "queued")).run();
  expect(await (await GET(request)).json()).toEqual({ idle: true });
});
