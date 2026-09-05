import { load } from "cheerio";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";
import { throwIfScrapeAborted } from "@/lib/scraper/infrastructure/cancellation";

interface HtmlPageResult {
  page: number;
  url: string;
  html: string;
}

export interface PaginatedHtmlFetchResult {
  pages: HtmlPageResult[];
  totalPages: number;
  discoveredTotalPages: number;
  isComplete: boolean;
  truncatedByMaxPages: boolean;
  failedPages: number[];
  firstFailureStatus?: number;
}

export interface FetchPaginatedHtmlOptions {
  httpClient: IHttpClient;
  startUrl: string;
  headers?: Record<string, string>;
  timeout: number;
  retries: number;
  baseDelay: number;
  maxPages?: number;
}

const DEFAULT_MAX_PAGES = 20;

export function setPageQueryParam(inputUrl: string, page: number): string {
  const url = new URL(inputUrl);
  if (page <= 1) {
    url.searchParams.delete("page");
  } else {
    url.searchParams.set("page", String(page));
  }
  return url.toString();
}

export function extractMaxPageFromPagination(html: string, currentUrl: string): number {
  const $ = load(html);
  const current = new URL(currentUrl);

  let maxPage = Number(current.searchParams.get("page")) || 1;

  $("a[href]").each((_idx, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    try {
      const resolved = new URL(href, current.origin);
      const rawPage = resolved.searchParams.get("page");
      if (!rawPage) return;
      const parsed = Number.parseInt(rawPage, 10);
      if (!Number.isNaN(parsed) && parsed > maxPage) {
        maxPage = parsed;
      }
    } catch {
      // Ignore malformed hrefs
    }
  });

  return Math.max(1, maxPage);
}

export async function fetchPaginatedHtmlByPageParam(
  options: FetchPaginatedHtmlOptions
): Promise<PaginatedHtmlFetchResult> {
  const {
    httpClient,
    startUrl,
    headers,
    timeout,
    retries,
    baseDelay,
    maxPages,
  } = options;

  const effectiveMaxPages = maxPages ?? DEFAULT_MAX_PAGES;
  const pages: HtmlPageResult[] = [];
  const failedPages: number[] = [];

  const firstPageUrl = setPageQueryParam(startUrl, 1);
  const firstResponse = await httpClient.fetch(firstPageUrl, {
    headers,
    timeout,
    retries,
    baseDelay,
  });

  if (!firstResponse.ok) {
    return {
      pages,
      totalPages: 1,
      discoveredTotalPages: 1,
      isComplete: false,
      truncatedByMaxPages: false,
      failedPages: [1],
      firstFailureStatus: firstResponse.status,
    };
  }

  const firstHtml = await firstResponse.text();
  pages.push({ page: 1, url: firstPageUrl, html: firstHtml });

  let discoveredTotal = extractMaxPageFromPagination(firstHtml, firstPageUrl);
  let totalPages = Math.min(discoveredTotal, effectiveMaxPages);
  let truncatedByMaxPages = discoveredTotal > effectiveMaxPages;

  for (let page = 2; page <= totalPages; page++) {
    const pageUrl = setPageQueryParam(startUrl, page);

    try {
      const response = await httpClient.fetch(pageUrl, {
        headers,
        timeout,
        retries,
        baseDelay,
      });

      if (!response.ok) {
        failedPages.push(page);
        continue;
      }

      const html = await response.text();
      pages.push({
        page,
        url: pageUrl,
        html,
      });
      discoveredTotal = Math.max(
        discoveredTotal,
        extractMaxPageFromPagination(html, pageUrl)
      );
      totalPages = Math.min(discoveredTotal, effectiveMaxPages);
      truncatedByMaxPages ||= discoveredTotal > effectiveMaxPages;
    } catch (error) {
      throwIfScrapeAborted(error);
      failedPages.push(page);
    }
  }

  return {
    pages,
    totalPages,
    discoveredTotalPages: discoveredTotal,
    isComplete: failedPages.length === 0 && !truncatedByMaxPages,
    truncatedByMaxPages,
    failedPages,
  };
}

export function resolveUrl(baseUrl: string, maybeRelative: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}
