import { AIError } from "@/lib/ai/shared/errors";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface CustomProviderFetchOptions {
  stripHeaders?: string[];
}

export async function cancelCustomProviderResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
  }
}

export function createCustomProviderFetch(
  options: CustomProviderFetchOptions = {}
): typeof fetch {
  const stripHeaders = new Set(
    (options.stripHeaders ?? []).map((name) => name.toLowerCase())
  );

  return async (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    );
    for (const name of Array.from(headers.keys())) {
      if (stripHeaders.has(name.toLowerCase())) headers.delete(name);
    }

    const response = await fetch(input, {
      ...init,
      headers,
      redirect: "manual",
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const sourceUrl = new URL(input instanceof Request ? input.url : input.toString());
    const location = response.headers.get("location");
    const targetUrl = location ? new URL(location, sourceUrl) : null;
    await cancelCustomProviderResponse(response);
    throw new AIError({
      type: "network",
      message: targetUrl && targetUrl.origin !== sourceUrl.origin
        ? "Custom provider refused a cross-origin redirect"
        : "Custom provider redirects are not supported; use the final API URL",
      retryable: false,
    });
  };
}

export const customProviderFetch = createCustomProviderFetch();
