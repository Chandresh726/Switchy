import { load } from "cheerio";

import type { IHttpClient } from "@/lib/scraper/infrastructure/http-client";

export interface HtmlPageResult {
  page: number;
  url: string;
  html: string;
}

export interface PaginatedHtmlFetchResult {
  pages: HtmlPageResult[];
  totalPages: number;
  isComplete: boolean;
  failedPages: number[];
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
      isComplete: false,
      failedPages: [1],
    };
  }

  const firstHtml = await firstResponse.text();
  pages.push({ page: 1, url: firstPageUrl, html: firstHtml });

  const discoveredTotal = extractMaxPageFromPagination(firstHtml, firstPageUrl);
  const totalPages = maxPages ? Math.min(discoveredTotal, maxPages) : discoveredTotal;

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
    } catch {
      failedPages.push(page);
    }
  }

  return {
    pages,
    totalPages,
    isComplete: failedPages.length === 0,
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
