import { describe, expect, it } from "vitest";

import { assertAppRequest } from "@/lib/api/request-guard";

describe("assertAppRequest", () => {
  it("accepts app-header requests without origin or referer", () => {
    const request = new Request("http://localhost/api/scheduler/recover", {
      headers: {
        "x-switchy-request": "true",
      },
    });

    expect(() => assertAppRequest(request)).not.toThrow();
  });

  it("rejects app-header requests from a different origin", () => {
    const request = new Request("http://localhost/api/scheduler/recover", {
      headers: {
        origin: "http://evil.example.com",
        "x-switchy-request": "true",
      },
    });

    expect(() => assertAppRequest(request)).toThrow("Cross-origin requests are not allowed");
  });
});
