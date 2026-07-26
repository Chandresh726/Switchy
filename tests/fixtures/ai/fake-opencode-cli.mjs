#!/usr/bin/env node

import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

if (process.env.SWITCHY_FAKE_OPENCODE_INCOMPATIBLE === "1") {
  process.stderr.write("unknown option: --pure\n");
  process.exit(2);
}

if (process.env.SWITCHY_FAKE_OPENCODE_STARTUP_CRASH === "1") {
  process.exit(2);
}

if (process.env.SWITCHY_FAKE_CLI_AUDIT_PATH) {
  appendFileSync(
    process.env.SWITCHY_FAKE_CLI_AUDIT_PATH,
    `${JSON.stringify({ cli: "opencode", argv: process.argv.slice(2) })}\n`
  );
}
if (process.env.SWITCHY_FAKE_OPENCODE_PID_PATH) {
  writeFileSync(
    process.env.SWITCHY_FAKE_OPENCODE_PID_PATH,
    `${process.pid}\n`
  );
}

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const expectedAuth = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
const streams = new Set();
let deletedSessions = 0;
let sessionExists = false;
let pendingMessageResponse;

function resolveSchema(schema, root) {
  if (!schema?.$ref) return schema ?? {};
  const segments = schema.$ref.replace(/^#\//, "").split("/");
  return segments.reduce((value, segment) => value?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], root) ?? {};
}

function synthesizeSchema(schema, root, key, prompt) {
  const resolved = resolveSchema(schema, root);
  if (resolved.const !== undefined) return resolved.const;
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) return resolved.enum[0];
  const alternatives = resolved.anyOf ?? resolved.oneOf;
  if (Array.isArray(alternatives)) {
    const nullable = alternatives.find((item) => resolveSchema(item, root).type === "null");
    if (nullable) return null;
    return synthesizeSchema(alternatives[0], root, key, prompt);
  }
  const type = Array.isArray(resolved.type)
    ? resolved.type.find((item) => item !== "null")
    : resolved.type;
  if (type === "object" || resolved.properties) {
    const required = new Set(resolved.required ?? []);
    return Object.fromEntries(Object.entries(resolved.properties ?? {}).flatMap(([property, definition]) =>
      required.has(property)
        ? [[property, synthesizeSchema(definition, root, property, prompt)]]
        : []
    ));
  }
  if (type === "array") {
    if (key === "candidateEvidenceReferences") {
      const evidenceId = prompt.match(/"evidence":\[\{"id":"([^"]+)"/)?.[1];
      return evidenceId ? [evidenceId] : [];
    }
    return key === "" || (resolved.minItems ?? 0) > 0
      ? [synthesizeSchema(resolved.items, root, "item", prompt)]
      : [];
  }
  if (type === "number" || type === "integer") {
    if (key === "jobId") return Number(prompt.match(/"jobId"\s*:\s*(\d+)/)?.[1] ?? 1);
    if (key === "score") return 88;
    return key.toLowerCase().includes("confidence") ? 0.95 : Math.max(1, resolved.minimum ?? 1);
  }
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (key === "status") return "ready";
  if (key === "value") return "structured";
  if (key === "name") return "Alex Candidate";
  if (key === "startDate" || key === "endDate") return "2025-01";
  return "Synthetic evidence";
}

function portableSchema(system) {
  const schemaText = system
    ?.split("JSON SCHEMA:\n")[1]
    ?.split("\n\nSECURITY BOUNDARY:")[0]
    ?.trim();
  if (!schemaText) return undefined;
  try {
    return JSON.parse(schemaText);
  } catch {
    return undefined;
  }
}

function json(response, value, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expectedAuth) {
    json(response, { error: "unauthorized" }, 401);
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/global/health") {
    if (process.env.SWITCHY_FAKE_OPENCODE_MISSING_HEALTH === "1") {
      json(response, { error: "not found" }, 404);
      return;
    }
    json(response, { healthy: true, version: "8.8.8" });
    return;
  }
  if (request.method === "GET" && url.pathname === "/provider") {
    json(response, {
      all: [],
      default: { openai: "text" },
      connected: process.env.SWITCHY_FAKE_OPENCODE_DISCONNECTED === "1"
        ? []
        : ["openai"],
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/config/providers") {
    json(response, {
      providers: [{
        id: "openai",
        name: "OpenAI",
        source: "config",
        env: [],
        options: {},
        models: {
          text: {
            id: "text",
            providerID: "openai",
            api: { id: "text", url: "", npm: "" },
            name: "Text Model",
            family: "gpt",
            capabilities: {
              temperature: true,
              reasoning: true,
              attachment: false,
              toolcall: false,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 1000, output: 100 },
            status: "active",
            options: {},
            headers: {},
            release_date: "2026-01-01",
            variants: {
              minimal: {},
              low: {},
              medium: {},
              high: {},
              xhigh: {},
              max: {},
              future_v1: {},
            },
          },
          image: {
            id: "image",
            providerID: "openai",
            api: { id: "image", url: "", npm: "" },
            name: "Image Model",
            capabilities: {
              temperature: false, reasoning: false, attachment: true, toolcall: false,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: false, audio: false, image: true, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 1000, output: 100 }, status: "active", options: {}, headers: {}, release_date: "2026-01-01",
          },
        },
      }, {
        id: "disconnected",
        name: "Disconnected Provider",
        source: "config",
        env: [],
        options: {},
        models: {
          unavailable: {
            id: "unavailable",
            providerID: "disconnected",
            api: { id: "unavailable", url: "", npm: "" },
            name: "Unavailable Model",
            capabilities: {
              temperature: true, reasoning: false, attachment: false, toolcall: false,
              input: { text: true, audio: false, image: false, video: false, pdf: false },
              output: { text: true, audio: false, image: false, video: false, pdf: false },
              interleaved: false,
            },
            cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
            limit: { context: 1000, output: 100 }, status: "active", options: {}, headers: {}, release_date: "2026-01-01",
          },
        },
      }],
      default: { openai: "text" },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/event") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.flushHeaders();
    streams.add(response);
    request.on("close", () => streams.delete(response));
    return;
  }
  if (request.method === "POST" && url.pathname === "/session") {
    if (sessionExists) {
      json(response, { error: "previous session was not deleted" }, 409);
      return;
    }
    sessionExists = true;
    json(response, { id: "session-1", slug: "switchy", projectID: "p", directory: url.searchParams.get("directory") ?? "" });
    return;
  }
  if (request.method === "POST" && url.pathname === "/session/session-1/message") {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      const prompt = parsed.parts?.[0]?.text ?? "";
      if (prompt.includes("unknown-support") && parsed.variant !== undefined) {
        json(response, { error: "unexpected reasoning variant" }, 400);
        return;
      }
      if (prompt.includes("require-max-effort") && parsed.variant !== "max") {
        json(response, { error: "provider-native effort was not preserved" }, 400);
        return;
      }
      if (prompt === "rate-limit") {
        response.writeHead(429, { "content-type": "application/json", "retry-after": "1" });
        response.end(JSON.stringify({ error: "rate limited" }));
        return;
      }
      if (prompt.includes("missing-model")) {
        json(response, { error: "model unavailable" }, 400);
        return;
      }
      const structured = parsed.format?.type === "json_schema";
      const textSchema = portableSchema(parsed.system);
      const textOutput = textSchema
        ? JSON.stringify(synthesizeSchema(textSchema, textSchema, "", prompt))
        : "hello";
      const embeddedError = prompt.includes("embedded-auth-error")
        ? { name: "ProviderAuthError", data: { providerID: "openai", message: "synthetic secret" } }
        : prompt.includes("embedded-rate-limit")
          ? { name: "APIError", data: { message: "synthetic body", statusCode: 429, isRetryable: true, responseHeaders: { "retry-after": "2" } } }
          : prompt.includes("embedded-abort")
            ? { name: "MessageAbortedError", data: { message: "synthetic abort details" } }
            : prompt.includes("embedded-length")
              ? { name: "MessageOutputLengthError", data: {} }
              : prompt.includes("embedded-structured")
                ? { name: "StructuredOutputError", data: { message: "synthetic invalid JSON", retries: 0 } }
                : undefined;
      for (const stream of streams) {
        stream.write(`data: ${JSON.stringify({ type: "message.part.delta", properties: { sessionID: "session-1", field: "text", delta: textOutput } })}\n\n`);
        if (prompt.includes("close-event-stream")) {
          stream.end();
        } else {
          stream.write(`data: ${JSON.stringify({ type: "session.idle", properties: { sessionID: "session-1" } })}\n\n`);
        }
      }
      const complete = () => json(response, {
        info: {
          id: "assistant-1", sessionID: "session-1", role: "assistant",
          time: { created: Date.now(), completed: Date.now() }, parentID: "user-1",
          modelID: "text", providerID: "openai", mode: "build", agent: "build",
          path: { cwd: "", root: "" }, tokens: { total: 9, input: 6, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
          structured: structured ? { value: "structured" } : undefined, finish: "stop", error: embeddedError,
        },
        parts: structured ? [] : [{ id: "part-1", sessionID: "session-1", messageID: "assistant-1", type: "text", text: textOutput }],
      });
      if (prompt.includes("slow")) {
        pendingMessageResponse = complete;
      } else if (prompt.includes("medium-delay")) {
        setTimeout(complete, 150);
      } else {
        complete();
      }
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/session/session-1/abort") {
    json(response, true);
    pendingMessageResponse?.();
    pendingMessageResponse = undefined;
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/session/session-1") {
    deletedSessions += 1;
    sessionExists = false;
    json(response, true);
    return;
  }
  if (request.method === "GET" && url.pathname === "/test/cleanup") {
    json(response, { deletedSessions });
    return;
  }
  json(response, { error: "not found", path: url.pathname }, 404);
});

const parentPid = process.ppid;
const parentWatch = setInterval(() => {
  if (process.ppid !== parentPid) {
    clearInterval(parentWatch);
    server.close(() => process.exit(0));
  }
}, 250);
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => {
  clearInterval(parentWatch);
  server.close(() => process.exit(0));
});
