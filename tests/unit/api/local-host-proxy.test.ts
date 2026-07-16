import { NextRequest } from "next/server";

import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

describe("local host proxy", () => {
  it.each([
    "http://localhost:3000/api/profile",
    "http://127.0.0.1:3000/api/profile",
  ])("allows a local read request to %s", (url) => {
    const request = new NextRequest(url, {
      headers: { host: new URL(url).host },
    });

    const response = proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects a DNS-rebinding read request", async () => {
    const request = new NextRequest("http://attacker.example/api/profile", {
      headers: { host: "attacker.example" },
    });

    const response = proxy(request);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Switchy is available only on this device",
    });
  });

  it("rejects a conflicting Host header", () => {
    const request = new NextRequest("http://127.0.0.1:3000/api/profile", {
      headers: { host: "attacker.example" },
    });

    expect(proxy(request).status).toBe(403);
  });
});
