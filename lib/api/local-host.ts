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
  let requestHostname: string;
  try {
    requestHostname = new URL(request.url).hostname;
  } catch {
    return false;
  }

  if (!ALLOWED_LOCAL_HOSTNAMES.has(requestHostname)) {
    return false;
  }

  const hostHeader = request.headers.get("host");
  if (hostHeader === null) {
    return true;
  }

  const headerHostname = parseHostHeader(hostHeader);
  return headerHostname !== null && ALLOWED_LOCAL_HOSTNAMES.has(headerHostname);
}
