import { ValidationError } from "./error-handler";
import { resolveLocalRequestOrigin } from "./local-host";

const APP_REQUEST_HEADER = "x-switchy-request";

type CallerOrigin =
  | { kind: "absent" }
  | { kind: "valid"; origin: string }
  | { kind: "invalid" };

function parseOriginHeader(value: string): CallerOrigin {
  try {
    const parsed = new URL(value);
    const serializedOrigin = parsed.origin;

    if (serializedOrigin === "null" || value !== serializedOrigin) {
      return { kind: "invalid" };
    }

    return { kind: "valid", origin: serializedOrigin };
  } catch {
    return { kind: "invalid" };
  }
}

function parseRefererHeader(value: string): CallerOrigin {
  try {
    const parsed = new URL(value);
    if (parsed.origin === "null") {
      return { kind: "invalid" };
    }

    return { kind: "valid", origin: parsed.origin };
  } catch {
    return { kind: "invalid" };
  }
}

function resolveCallerOrigins(request: Request): CallerOrigin[] {
  const origins: CallerOrigin[] = [];
  const origin = request.headers.get("origin");
  if (origin !== null) {
    origins.push(parseOriginHeader(origin));
  }

  const referer = request.headers.get("referer");
  if (referer !== null) {
    origins.push(parseRefererHeader(referer));
  }

  return origins.length > 0 ? origins : [{ kind: "absent" }];
}

export function assertAppRequest(request: Request): void {
  // This validates browser mutation provenance for the loopback-only app. It is
  // request-integrity protection, not user authentication or authorization.
  const callerOrigins = resolveCallerOrigins(request);
  const appOrigin = resolveLocalRequestOrigin(request);
  const hasAppHeader = request.headers.get(APP_REQUEST_HEADER) === "true";
  const hasInvalidCaller = callerOrigins.some(
    (caller) => caller.kind === "invalid"
  );
  const hasMismatchedCaller = callerOrigins.some(
    (caller) => caller.kind === "valid" && caller.origin !== appOrigin
  );

  if (
    !hasAppHeader ||
    appOrigin === null ||
    hasInvalidCaller ||
    hasMismatchedCaller
  ) {
    throw new ValidationError("Cross-origin requests are not allowed", "cross_origin_forbidden", 403);
  }
}
