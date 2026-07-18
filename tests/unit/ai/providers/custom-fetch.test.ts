import { beforeEach, describe, expect, it, vi } from "vitest";

import { createCustomProviderFetch } from "@/lib/ai/providers/custom-fetch";

describe("custom provider fetch", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects cross-origin redirects without following them", async () => {
    const response = new Response("redirect", {
      status: 302,
      headers: { Location: "https://attacker.example/models" },
    });
    const cancel = vi.spyOn(response.body!, "cancel");
    cancel.mockRejectedValueOnce(new Error("cancel failed"));
    fetchMock.mockResolvedValue(response);
    const guardedFetch = createCustomProviderFetch();

    await expect(guardedFetch("https://proxy.example/v1/models", {
      headers: { "x-api-key": "secret" },
    })).rejects.toMatchObject({
      type: "network",
      message: "Custom provider refused a cross-origin redirect",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://proxy.example/v1/models",
      expect.objectContaining({ redirect: "manual" })
    );
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("strips placeholder authentication case-insensitively", async () => {
    fetchMock.mockResolvedValue(new Response("{}"));
    const guardedFetch = createCustomProviderFetch({ stripHeaders: ["Authorization"] });

    await guardedFetch("http://localhost:8317/v1/responses", {
      headers: { authorization: "Bearer switchy-no-auth", "X-Route": "local" },
    });

    const sentHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(sentHeaders.has("authorization")).toBe(false);
    expect(sentHeaders.get("x-route")).toBe("local");
  });
});
