import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AIUsageOverview } from "@/components/history/ai-usage-overview";
import type { AIUsagePeriod } from "@/lib/ai/observability";

function usage(
  days: AIUsagePeriod,
  group: "matching" | "writing" = "matching"
) {
  const capabilityNames = group === "writing"
    ? [
        "writing_cover_letter",
        "writing_referral",
        "writing_recruiter_follow_up",
      ]
    : ["job_analysis", "match_evaluation", "match_adjudication"];

  return {
    days,
    periodStart: "2026-07-07T00:00:00.000Z",
    periodEnd: "2026-07-14T00:00:00.000Z",
    executions: days === 7 ? 10 : days === 30 ? 25 : 40,
    calls: days === 7 ? 12 : days === 30 ? 30 : 48,
    succeeded: 10,
    failed: 2,
    running: 0,
    cancelled: 1,
    abandoned: 1,
    successRate: 83,
    terminalExecutions: 10,
    tokenTrackedExecutions: 9,
    tokenCoveragePercent: 90,
    inputTokens: 1_000,
    inputNoCacheTokens: 700,
    inputCacheReadTokens: 250,
    inputCacheWriteTokens: 50,
    outputTokens: 500,
    outputTextTokens: 400,
    outputReasoningTokens: 100,
    totalTokens: 1_500,
    averageLatencyMs: 1_250,
    cacheHits: 5,
    fullMatchCacheReuses: 4,
    capabilities: [
      {
        capability: capabilityNames[0],
        executions: 7,
        calls: 8,
        succeeded: 8,
        failed: 0,
        abandoned: 0,
        cacheHits: 2,
        tokenTrackedExecutions: 7,
        totalTokens: 1_000,
        averageLatencyMs: 800,
      },
      {
        capability: capabilityNames[1],
        executions: 2,
        calls: 3,
        succeeded: 2,
        failed: 0,
        abandoned: 0,
        cacheHits: 0,
        tokenTrackedExecutions: 2,
        totalTokens: 350,
        averageLatencyMs: 950,
      },
      {
        capability: capabilityNames[2],
        executions: 1,
        calls: 1,
        succeeded: 1,
        failed: 0,
        abandoned: 0,
        cacheHits: 0,
        tokenTrackedExecutions: 1,
        totalTokens: 150,
        averageLatencyMs: 700,
      },
    ],
    providers: [{
      provider: "openai",
      modelId: "gpt-5",
      executions: 7,
      calls: 8,
      succeeded: 7,
      failed: 0,
      abandoned: 0,
      totalTokens: 1_000,
    }],
    failures: [{ code: "timeout", count: 2 }],
  };
}

describe("AIUsageOverview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps matching usage compact until details are requested", async () => {
    const requests: string[] = [];
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return Response.json(usage(
        url.includes("days=all") ? "all" : url.includes("days=30") ? 30 : 7
      ));
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AIUsageOverview group="matching" />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Matching AI usage" })).toBeTruthy();
    expect(await screen.findByText("Provider calls")).toBeTruthy();
    expect(screen.getByText("Success rate")).toBeTruthy();
    expect(screen.getByText("Total tokens")).toBeTruthy();
    expect(screen.getByText("Average latency")).toBeTruthy();
    expect(screen.getByText((_, element) => (
      element?.tagName === "SPAN" && element.textContent === "2 retries"
    ))).toBeTruthy();
    expect(screen.getByText((_, element) => (
      element?.tagName === "SPAN" && element.textContent === "10 succeeded"
    ))).toBeTruthy();
    expect(screen.queryByText(/Cost is not estimated/)).toBeNull();
    expect(screen.queryByText("Token usage")).toBeNull();
    expect(screen.queryByText("Providers and models")).toBeNull();
    const periodSelect = screen.getByRole("combobox", { name: "Usage period" });
    expect(periodSelect.textContent).toContain("7 days");

    const detailsButton = screen.getByRole("button", { name: "View details" });
    expect(detailsButton.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(detailsButton);

    expect(screen.getByText("Run overview")).toBeTruthy();
    expect(screen.getByText("Token usage")).toBeTruthy();
    expect(screen.getByText("Providers and models")).toBeTruthy();
    expect(screen.getByText("Capability breakdown")).toBeTruthy();
    for (const title of ["Providers and models", "Capability breakdown"]) {
      const section = screen.getByText(title).closest("[data-slot='card-content']");
      expect(section?.className).toContain("gap-2");
      expect(section?.className).toContain("py-1.5");
    }
    expect(screen.getByText("Input").tagName).toBe("DT");
    expect(screen.getByText("Cache read").tagName).toBe("DT");
    expect(screen.getByText("Output").tagName).toBe("DT");
    expect(screen.getByText("Reasoning").tagName).toBe("DT");
    expect(screen.getByText("Succeeded").tagName).toBe("DT");
    expect(screen.getByText("Failed").tagName).toBe("DT");
    expect(screen.getByText("Cancelled").tagName).toBe("DT");
    expect(screen.getByText("Interrupted").tagName).toBe("DT");
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.queryByText("Token coverage")).toBeNull();
    expect(screen.queryByText("Cache hits")).toBeNull();
    expect(screen.queryByText("Full match reuse")).toBeNull();
    expect(screen.queryByText("Uncached input")).toBeNull();
    expect(screen.queryByText("Cache write")).toBeNull();
    expect(screen.queryByText("Text output")).toBeNull();
    expect(screen.queryByText("Failure codes")).toBeNull();
    expect(screen.queryByText("Timeout · 2")).toBeNull();
    expect(screen.getByText("gpt-5")).toBeTruthy();
    const details = document.getElementById("matching-ai-usage-details");
    expect(details?.className).toContain("contents");
    expect(details?.previousElementSibling?.getAttribute("data-slot")).toBe("card-footer");
    expect(details?.previousElementSibling?.className).toContain("py-1");
    expect(details?.previousElementSibling?.className).toContain("border-b");
    const separators = details?.querySelectorAll(":scope > [data-slot='separator']");
    expect(separators).toHaveLength(2);
    separators?.forEach((separator) => {
      expect(separator.className).toContain("w-full");
      expect(separator.parentElement).toBe(details);
    });
    const detailSections = details?.querySelectorAll(":scope > [data-slot='card-content']");
    expect(detailSections).toHaveLength(3);
    const overviewSplit = details?.querySelector("[data-overview-split]");
    expect(overviewSplit?.className).toContain("overflow-x-auto");
    const overviewGrid = overviewSplit?.querySelector("[data-overview-grid]");
    expect(overviewGrid?.className).toContain("min-w-[48rem]");
    expect((overviewGrid as HTMLElement | null)?.style.gridTemplateColumns)
      .toContain("6fr");
    expect((overviewGrid as HTMLElement | null)?.style.gridTemplateColumns)
      .toContain("4fr");
    expect(overviewGrid?.querySelectorAll(":scope > section")).toHaveLength(2);
    expect(overviewGrid?.querySelectorAll(":scope > [data-slot='separator']")).toHaveLength(1);
    const sectionDividers = details?.querySelectorAll("[data-section-divider]");
    expect(sectionDividers).toHaveLength(0);
    expect((screen.getByText("Run overview").closest("section")
      ?.querySelector("dl") as HTMLElement | null)?.style.gridTemplateColumns)
      .toContain("repeat(6");
    expect((screen.getByText("Token usage").closest("section")
      ?.querySelector("dl") as HTMLElement | null)?.style.gridTemplateColumns)
      .toContain("repeat(4");
    const detailListCards = details?.querySelectorAll("[data-detail-list-card]");
    expect(detailListCards).toHaveLength(1);
    detailListCards?.forEach((card) => {
      expect(card.className).toContain("rounded-md");
      expect(card.className).toContain("bg-background/60");
    });
    const capabilityStrip = details?.querySelector("[data-capability-strip]");
    expect(capabilityStrip?.className).toContain("overflow-x-auto");
    expect(capabilityStrip?.closest("[data-detail-list-card]")).toBeNull();
    const capabilityGrid = capabilityStrip?.querySelector("[data-capability-grid]");
    expect(capabilityGrid?.querySelectorAll("[data-capability-item]")).toHaveLength(3);
    expect(capabilityGrid?.querySelectorAll("[data-slot='separator']")).toHaveLength(2);
    expect((capabilityGrid as HTMLElement | null)?.style.minWidth).toBe("48rem");
    expect(details?.querySelector(".rounded-lg.border")).toBeNull();
    expect(screen.getByRole("button", { name: "Hide details" }).getAttribute("aria-expanded"))
      .toBe("true");

    fireEvent.click(periodSelect);
    expect(screen.getByRole("option", { name: "30 days" })).toBeTruthy();
    expect(document.querySelector("[data-slot='select-content']")?.className)
      .toContain("w-28");
    expect(document.querySelector("[data-slot='select-content']")?.className)
      .toContain("min-w-28");
    expect(document.querySelector("[data-slot='select-content']")?.className)
      .not.toContain("min-w-36");
    fireEvent.click(screen.getByRole("option", { name: "All time" }));
    await waitFor(() => expect(requests).toContain(
      "/api/ai/usage?days=all&group=matching"
    ));
    expect(await screen.findByText("48")).toBeTruthy();
  });

  it("keeps matching usage visible while another period is loading", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    let resolveAllTime: ((response: Response) => void) | undefined;
    const allTimeResponse = new Promise<Response>((resolve) => {
      resolveAllTime = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("days=all")) {
        return allTimeResponse;
      }
      return Response.json(usage(7));
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AIUsageOverview group="matching" />
      </QueryClientProvider>
    );

    expect(await screen.findByText("12")).toBeTruthy();
    const periodSelect = screen.getByRole("combobox", { name: "Usage period" });
    fireEvent.click(periodSelect);
    fireEvent.click(screen.getByRole("option", { name: "All time" }));

    expect(periodSelect.textContent).toContain("All time");
    expect(screen.getByText("12")).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeNull();

    await act(async () => {
      resolveAllTime?.(Response.json(usage("all")));
    });
    expect(await screen.findByText("48")).toBeTruthy();
  });

  it("uses the compact expandable overview for writing usage", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      return Response.json(usage(
        url.includes("days=all") ? "all" : url.includes("days=30") ? 30 : 7,
        "writing"
      ));
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AIUsageOverview group="writing" />
      </QueryClientProvider>
    );

    expect(await screen.findByRole("heading", { name: "Writing AI usage" })).toBeTruthy();
    expect(screen.getByText("Cover letters, referrals, and follow-up telemetry.")).toBeTruthy();
    expect(await screen.findByText("Provider calls")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Usage period" }).textContent)
      .toContain("7 days");
    expect(screen.queryByText("Token usage")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "View details" }));

    expect(screen.getByText("Run overview")).toBeTruthy();
    expect(screen.getByText("Token usage")).toBeTruthy();
    expect(screen.getByText("Providers and models")).toBeTruthy();
    expect(screen.getByText("Capability breakdown")).toBeTruthy();
    expect(screen.getByText("Cover letter")).toBeTruthy();
    expect(screen.getByText("Referral")).toBeTruthy();
    expect(screen.getByText("Follow-up")).toBeTruthy();
    expect(screen.queryByText("Writing Cover Letter")).toBeNull();
    expect(screen.queryByText("Writing Referral")).toBeNull();
    expect(screen.queryByText("Writing Recruiter Follow Up")).toBeNull();
    expect(screen.queryByText("Full match reuse")).toBeNull();
    expect(document.getElementById("writing-ai-usage-details")
      ?.querySelectorAll("[data-detail-list-card]")).toHaveLength(1);
    expect(document.getElementById("writing-ai-usage-details")
      ?.querySelectorAll("[data-capability-item]")).toHaveLength(3);
    expect(requests).toContain("/api/ai/usage?days=7&group=writing");
  });

  it("shows a retry action when usage cannot be loaded", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json(usage(7)));
    vi.stubGlobal("fetch", fetchMock);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <AIUsageOverview group="matching" />
      </QueryClientProvider>
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "AI usage could not be loaded."
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("12")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
