import { AIError } from "@/lib/ai/shared/errors";
import { decryptSecret, encryptSecret } from "@/lib/encryption";

import {
  isCustomAPIFormat,
  type CustomAPIFormat,
} from "./types";

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const FORBIDDEN_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "transfer-encoding",
]);

export interface CustomHeaderInput {
  name: string;
  value: string;
}

export interface CustomHeaderPatchInput {
  name: string;
  value?: string;
}

export interface CustomProviderConnection {
  displayName: string;
  apiFormat: CustomAPIFormat;
  baseUrl: string;
  apiKey?: string;
  headers: Record<string, string>;
  manualModelIds: string[];
}

interface StoredCustomProviderRecord {
  provider: string;
  displayName: string | null;
  apiFormat: string | null;
  baseUrl: string | null;
  encryptedHeaders: string | null;
  manualModelIds: string | null;
}

function configurationError(message: string): AIError {
  return new AIError({
    type: "validation",
    message,
    retryable: false,
  });
}

export function normalizeCustomDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw configurationError("Custom provider name is required");
  if (normalized.length > 100) {
    throw configurationError("Custom provider name must be 100 characters or fewer");
  }
  return normalized;
}

export function normalizeCustomBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw configurationError("Custom provider URL must be an absolute HTTP or HTTPS URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw configurationError("Custom provider URL must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw configurationError("Custom provider URL must not contain embedded credentials");
  }
  if (url.search || url.hash) {
    throw configurationError("Custom provider URL must not contain a query string or fragment");
  }

  return url.toString().replace(/\/+$/, "");
}

function normalizeCustomHeaderName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100 || !HEADER_NAME_PATTERN.test(normalized)) {
    throw configurationError("Custom header name is invalid");
  }
  if (FORBIDDEN_HEADERS.has(normalized.toLowerCase())) {
    throw configurationError(`The ${normalized} header is controlled by the HTTP transport`);
  }
  return normalized;
}

function validateHeaderValue(value: string): string {
  if (value.length > 10_000) {
    throw configurationError("Custom header values must be 10,000 characters or fewer");
  }
  if (/[\r\n]/.test(value)) {
    throw configurationError("Custom header values must not contain line breaks");
  }
  return value;
}

export function normalizeCustomHeaders(
  headers: readonly CustomHeaderInput[]
): Record<string, string> {
  if (headers.length > 50) {
    throw configurationError("A custom provider can configure at most 50 headers");
  }

  const normalized: Record<string, string> = {};
  const seen = new Set<string>();
  for (const header of headers) {
    const name = normalizeCustomHeaderName(header.name);
    const canonicalName = name.toLowerCase();
    if (seen.has(canonicalName)) {
      throw configurationError(`Custom header ${name} is configured more than once`);
    }
    seen.add(canonicalName);
    normalized[name] = validateHeaderValue(header.value);
  }
  return normalized;
}

export function mergeCustomHeaderPatch(
  existing: Record<string, string>,
  desired: readonly CustomHeaderPatchInput[]
): Record<string, string> {
  const existingByName = new Map(
    Object.entries(existing).map(([name, value]) => [name.toLowerCase(), { name, value }])
  );
  const materialized = desired.map((header) => {
    const name = normalizeCustomHeaderName(header.name);
    const oldHeader = existingByName.get(name.toLowerCase());
    if (header.value === undefined) {
      if (!oldHeader) {
        throw configurationError(`A value is required for new custom header ${name}`);
      }
      return { name, value: oldHeader.value };
    }
    return { name, value: header.value };
  });
  return normalizeCustomHeaders(materialized);
}

export function normalizeManualModelIds(values: readonly string[]): string[] {
  if (values.length > 200) {
    throw configurationError("A custom provider can configure at most 200 manual models");
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const modelId = value.trim();
    if (!modelId) continue;
    if (modelId.length > 240) {
      throw configurationError("Custom model IDs must be 240 characters or fewer");
    }
    if (!seen.has(modelId)) {
      seen.add(modelId);
      normalized.push(modelId);
    }
  }
  return normalized;
}

export function encryptCustomHeaders(headers: Record<string, string>): string | null {
  return Object.keys(headers).length > 0
    ? encryptSecret(JSON.stringify(headers))
    : null;
}

function decryptCustomHeaders(encrypted: string | null): Record<string, string> {
  if (!encrypted) return {};
  try {
    const value = JSON.parse(decryptSecret(encrypted)) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid stored header object");
    }
    return normalizeCustomHeaders(Object.entries(value).map(([name, headerValue]) => {
      if (typeof headerValue !== "string") throw new Error("Invalid stored header value");
      return { name, value: headerValue };
    }));
  } catch (error) {
    throw new AIError({
      type: "decryption_failed",
      message: "Failed to decrypt custom provider headers",
      cause: error instanceof Error ? error : undefined,
    });
  }
}

function parseStoredManualModelIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("Invalid stored model list");
    }
    return normalizeManualModelIds(parsed);
  } catch (error) {
    throw new AIError({
      type: "validation",
      message: "Stored custom provider model IDs are invalid",
      cause: error instanceof Error ? error : undefined,
      retryable: false,
    });
  }
}

export function resolveStoredCustomProvider(
  record: StoredCustomProviderRecord,
  apiKey?: string
): CustomProviderConnection {
  if (record.provider !== "custom") {
    throw configurationError("Provider is not a custom provider");
  }
  if (!record.apiFormat || !isCustomAPIFormat(record.apiFormat)) {
    throw configurationError("Stored custom provider API format is invalid");
  }
  return {
    displayName: normalizeCustomDisplayName(record.displayName ?? ""),
    apiFormat: record.apiFormat,
    baseUrl: normalizeCustomBaseUrl(record.baseUrl ?? ""),
    apiKey,
    headers: decryptCustomHeaders(record.encryptedHeaders),
    manualModelIds: parseStoredManualModelIds(record.manualModelIds),
  };
}

export function buildCustomRequestHeaders(
  connection: Pick<CustomProviderConnection, "apiFormat" | "apiKey" | "headers">
): Record<string, string> {
  const authentication: Record<string, string> = connection.apiKey
    ? connection.apiFormat === "anthropic_messages"
      ? { "x-api-key": connection.apiKey, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${connection.apiKey}` }
    : connection.apiFormat === "anthropic_messages"
      ? { "anthropic-version": "2023-06-01" }
      : {};
  for (const [name, value] of Object.entries(connection.headers)) {
    const existingName = Object.keys(authentication).find(
      (headerName) => headerName.toLowerCase() === name.toLowerCase()
    );
    if (existingName) delete authentication[existingName];
    authentication[name] = value;
  }
  return authentication;
}
