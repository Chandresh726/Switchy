import { describe, expect, it, vi } from "vitest";

import { runWithScrapeSignal } from "@/lib/scraper/infrastructure/cancellation";
import {
  extractMaxPageFromPagination,
  fetchPaginatedHtmlByPageParam,
  resolveUrl,
  setPageQueryParam,
} from "@/lib/scraper/platforms/shared/html-pagination";
import { createHttpClientStub } from "@test/helpers/scraper-clients";

const htmlResponse = (html: string, status = 200) =>
  new Response(html, { status, headers: { "Content-Type": "text/html" } });

const fetchOptions = {
  startUrl: "https://jobs.example.com/search?query=engineer&page=9",
  timeout: 1_000,
  retries: 0,
  baseDelay: 0,
};

describe("HTML pagination", () => {
  it("sets and removes only the page query parameter", () => {
    expect(setPageQueryParam(fetchOptions.startUrl, 1)).toBe(
      "https://jobs.example.com/search?query=engineer"
    );
    expect(setPageQueryParam(fetchOptions.startUrl, 3)).toBe(
      "https://jobs.example.com/search?query=engineer&page=3"
    );
  });

  it("discovers the largest valid page from relative and absolute links", () => {
    const html = `
      <a href="?page=2">Two</a>
      <a href="/search?query=engineer&page=7">Seven</a>
      <a href="https://jobs.example.com/search?page=4">Four</a>
      <a href="?page=invalid">Invalid</a>
    `;

    expect(
      extractMaxPageFromPagination(
        html,
        "https://jobs.example.com/search?query=engineer"
      )
    ).toBe(7);
    expect(resolveUrl("https://jobs.example.com/search", "/job/1")).toBe(
      "https://jobs.example.com/job/1"
    );
  });

  it("returns a typed first-page failure without reading the body", async () => {
    const httpClient = createHttpClientStub({
      fetch: vi.fn(async () => htmlResponse("unavailable", 503)),
    });

    const result = await fetchPaginatedHtmlByPageParam({
      ...fetchOptions,
      httpClient,
    });

    expect(result).toEqual({
      pages: [],
      totalPages: 1,
      discoveredTotalPages: 1,
      isComplete: false,
      truncatedByMaxPages: false,
      failedPages: [1],
      firstFailureStatus: 503,
    });
  });

  it("continues after later HTTP and transport failures and reports partial coverage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse('<a href="?page=2">2</a><a href="?page=3">3</a>')
      )
      .mockResolvedValueOnce(htmlResponse("blocked", 429))
      .mockRejectedValueOnce(new TypeError("network down"));

    const result = await fetchPaginatedHtmlByPageParam({
      ...fetchOptions,
      httpClient: createHttpClientStub({ fetch: fetchMock }),
    });

    expect(result.pages.map((page) => page.page)).toEqual([1]);
    expect(result.failedPages).toEqual([2, 3]);
    expect(result.isComplete).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("expands the pending range when a later page reveals another page", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const page = new URL(url).searchParams.get("page");
      if (page === "2") {
        return htmlResponse('<a href="?query=engineer&page=3">3</a>');
      }
      if (page === "3") return htmlResponse("final page");
      return htmlResponse('<a href="?query=engineer&page=2">2</a>');
    });

    const result = await fetchPaginatedHtmlByPageParam({
      ...fetchOptions,
      httpClient: createHttpClientStub({ fetch: fetchMock }),
    });

    expect(result.pages.map((page) => page.page)).toEqual([1, 2, 3]);
    expect(result).toMatchObject({
      totalPages: 3,
      discoveredTotalPages: 3,
      isComplete: true,
    });
    expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).searchParams.get("query"))).toEqual([
      "engineer",
      "engineer",
      "engineer",
    ]);
  });

  it("marks a successful bounded crawl as intentionally truncated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<a href="?page=5">5</a>'))
      .mockResolvedValueOnce(htmlResponse("page two"));

    const result = await fetchPaginatedHtmlByPageParam({
      ...fetchOptions,
      httpClient: createHttpClientStub({ fetch: fetchMock }),
      maxPages: 2,
    });

    expect(result).toMatchObject({
      totalPages: 2,
      discoveredTotalPages: 5,
      truncatedByMaxPages: true,
      isComplete: false,
      failedPages: [],
    });
  });

  it("keeps a crawl complete when the discovered total equals the page limit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<a href="?page=2">2</a>'))
      .mockResolvedValueOnce(htmlResponse("page two"));

    const result = await fetchPaginatedHtmlByPageParam({
      ...fetchOptions,
      httpClient: createHttpClientStub({ fetch: fetchMock }),
      maxPages: 2,
    });

    expect(result).toMatchObject({
      totalPages: 2,
      discoveredTotalPages: 2,
      truncatedByMaxPages: false,
      isComplete: true,
      failedPages: [],
    });
  });

  it("propagates cancellation instead of converting it into a failed page", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse('<a href="?page=2">2</a>'))
      .mockImplementationOnce(async () => {
        controller.abort(new DOMException("cancelled", "AbortError"));
        throw new DOMException("cancelled", "AbortError");
      });

    await expect(
      runWithScrapeSignal(controller.signal, () =>
        fetchPaginatedHtmlByPageParam({
          ...fetchOptions,
          httpClient: createHttpClientStub({ fetch: fetchMock }),
        })
      )
    ).rejects.toMatchObject({ name: "AbortError", message: "cancelled" });
  });
});
