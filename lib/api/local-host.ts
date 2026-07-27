const ALLOWED_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

function parseHostHeader(value: string): string | null {
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    return parsed.hostname;
  } catch {
    return null;
  }
}

export function isAllowedLocalRequestHost(request: Request): boolean {
  return resolveLocalRequestOrigin(request) !== null;
}

export function resolveLocalRequestOrigin(request: Request): string | null {
  let requestUrl: URL;
  let requestHostname: string;
  try {
    requestUrl = new URL(request.url);
    requestHostname = requestUrl.hostname;
  } catch {
    return null;
  }

  if (!ALLOWED_LOCAL_HOSTNAMES.has(requestHostname)) {
    return null;
  }

  const hostHeader = request.headers.get("host");
  if (hostHeader === null) {
    return requestUrl.origin;
  }

  const headerHostname = parseHostHeader(hostHeader);
  if (
    headerHostname === null
    || !ALLOWED_LOCAL_HOSTNAMES.has(headerHostname)
  ) {
    return null;
  }

  try {
    return new URL(`${requestUrl.protocol}//${hostHeader}`).origin;
  } catch {
    return null;
  }
}
