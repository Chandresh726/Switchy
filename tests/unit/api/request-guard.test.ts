import { describe, expect, it } from "vitest";

import { assertAppRequest } from "@/lib/api/request-guard";

describe("assertAppRequest", () => {
  it("accepts a correctly marked same-origin request", () => {
    const request = new Request("http://localhost/api/scheduler/recover", {
      headers: {
        origin: "http://localhost",
        referer: "http://localhost/settings",
        "x-switchy-request": "true",
      },
    });

    expect(() => assertAppRequest(request)).not.toThrow();
  });

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

  it.each([
    ["malformed origin", { origin: "%%%" }],
    ["origin with a path", { origin: "http://localhost/not-an-origin" }],
    ["malformed referer", { referer: "%%%" }],
    ["mismatched referer", { referer: "http://evil.example.com/page" }],
  ])("rejects %s", (_label, callerHeaders) => {
    const request = new Request("http://localhost/api/scheduler/recover", {
      headers: {
        ...callerHeaders,
        "x-switchy-request": "true",
      },
    });

    expect(() => assertAppRequest(request)).toThrow("Cross-origin requests are not allowed");
  });

  it("rejects requests without the app marker header", () => {
    const request = new Request("http://localhost/api/scheduler/recover", {
      headers: { origin: "http://localhost" },
    });

    expect(() => assertAppRequest(request)).toThrow("Cross-origin requests are not allowed");
  });

  it("rejects a DNS-rebinding hostname with matching provenance", () => {
    const request = new Request("http://attacker.example/api/scheduler/recover", {
      headers: {
        host: "attacker.example",
        origin: "http://attacker.example",
        referer: "http://attacker.example/settings",
        "x-switchy-request": "true",
      },
    });

    expect(() => assertAppRequest(request)).toThrow("Cross-origin requests are not allowed");
  });
});
