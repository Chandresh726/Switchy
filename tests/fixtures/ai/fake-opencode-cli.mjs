#!/usr/bin/env node

import http from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);

if (process.env.SWITCHY_FAKE_OPENCODE_INCOMPATIBLE === "1" || args.includes("--pure")) {
  process.stderr.write("Unrecognized flag: --pure in command opencode serve\n");
  process.exit(2);
}

if (process.env.SWITCHY_FAKE_OPENCODE_STARTUP_CRASH === "1") {
  process.exit(2);
}

let config;
try {
  config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT ?? "null");
} catch {
  config = null;
}
const denyAll = config?.permissions?.some((rule) =>
  rule.action === "*" && rule.resource === "*" && rule.effect === "deny"
);
if (config?.share !== "disabled"
    || config?.update !== "disable"
    || config?.snapshots !== false
    || config?.formatter !== false
    || config?.lsp !== false
    || config?.default_agent !== "switchy"
    || !denyAll) {
  process.stderr.write("Invalid Switchy OpenCode v2 configuration\n");
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

const port = Number(args[args.indexOf("--port") + 1]);
const expectedAuth = `Basic ${Buffer.from(`${process.env.OPENCODE_SERVER_USERNAME}:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`;
const streams = new Set();
let deletedSessions = 0;
let sessionExists = false;
let sessionInstructions = "";
let sessionModel;
let assistantMessage;
const catalogStartsCold = process.env.SWITCHY_FAKE_OPENCODE_COLD_CATALOG === "1"
  || process.env.SWITCHY_FAKE_OPENCODE_PARTIAL_CATALOG === "1";
let catalogReady = !catalogStartsCold;

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

function empty(response) {
  response.writeHead(204);
  response.end();
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
}

function location() {
  return {
    directory: process.cwd(),
    project: { id: "p", directory: process.cwd(), canonical: process.cwd() },
  };
}

function emit(event) {
  for (const stream of streams) {
    stream.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function model({ enabled = true, modelID, output = ["text"], providerID = "openai" } = {}) {
  const resolvedModelID = modelID ?? (output.includes("text") ? "text" : "image");
  return {
    id: `${providerID}/${resolvedModelID}`,
    modelID: resolvedModelID,
    providerID,
    family: "gpt",
    name: output.includes("text") ? "Text Model" : "Image Model",
    capabilities: { tools: false, input: ["text"], output },
    variants: ["minimal", "low", "medium", "high", "xhigh", "max", "future_v2"]
      .map((id) => ({ id })),
    time: { released: Date.now() },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled,
    limit: { context: 1_000, output: 100 },
  };
}

const server = http.createServer((request, response) => {
  if (request.headers.authorization !== expectedAuth) {
    json(response, { error: "unauthorized" }, 401);
    return;
  }

  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/api/info") {
    if (process.env.SWITCHY_FAKE_OPENCODE_MISSING_HEALTH === "1") {
      json(response, { error: "not found" }, 404);
      return;
    }
    json(response, {
      version: "2.0.7",
      pid: process.pid,
      urls: [`http://127.0.0.1:${port}`],
      paths: { tmp: process.cwd() },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/provider") {
    json(response, {
      location: location(),
      data: catalogReady || process.env.SWITCHY_FAKE_OPENCODE_PARTIAL_CATALOG === "1" ? [{
        id: "openai",
        name: "OpenAI",
        activation: "enabled",
        package: "@opencode/ai/providers/openai",
      }] : [],
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/model") {
    json(response, {
      location: location(),
      data: catalogReady
        ? [
          model({ enabled: process.env.SWITCHY_FAKE_OPENCODE_DISCONNECTED !== "1" }),
          model({ providerID: "opencode", modelID: "muse-spark-1.3-contributor-free" }),
          model({ output: ["image"] }),
        ]
        : process.env.SWITCHY_FAKE_OPENCODE_PARTIAL_CATALOG === "1"
          ? [model({ modelID: "warming" })]
          : [],
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/model/default") {
    if (catalogStartsCold) {
      setTimeout(() => { catalogReady = true; }, 100);
    }
    json(response, {
      location: location(),
      data: catalogReady && process.env.SWITCHY_FAKE_OPENCODE_DISCONNECTED !== "1"
        ? model()
        : null,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/integration") {
    json(response, {
      location: location(),
      data: [
        {
          id: "openai",
          name: "OpenAI",
          methods: [{ type: "key", label: "API key" }],
          connections: process.env.SWITCHY_FAKE_OPENCODE_DISCONNECTED === "1"
            ? []
            : [{ type: "credential", id: "test", label: "Test account" }],
        },
        {
          id: "mcp_github",
          name: "GitHub MCP",
          methods: [{ type: "oauth", id: "github", label: "GitHub" }],
          connections: [{ type: "credential", id: "github", label: "GitHub" }],
        },
        {
          id: "opencode",
          name: "OpenCode",
          methods: [],
          connections: [{ type: "credential", id: "free-tier", label: "Free tier" }],
        },
      ],
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/event") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.flushHeaders();
    streams.add(response);
    response.write(`data: ${JSON.stringify({ id: "connected", type: "server.connected", data: {} })}\n\n`);
    request.on("close", () => streams.delete(response));
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/session") {
    if (sessionExists) {
      json(response, { _tag: "ConflictError", message: "previous session was not deleted" }, 409);
      return;
    }
    void readJson(request).then((parsed) => {
      sessionExists = true;
      sessionModel = parsed.model;
      json(response, { data: {
        id: "session-1",
        projectID: "p",
        agent: parsed.agent,
        model: parsed.model,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now(), updated: Date.now() },
        title: parsed.title,
        location: parsed.location,
        permissions: parsed.permissions,
      } });
    });
    return;
  }
  if (request.method === "PUT" && url.pathname === "/api/experimental/session/session-1/instructions/entries/switchy") {
    void readJson(request).then((parsed) => {
      sessionInstructions = typeof parsed.value === "string" ? parsed.value : "";
      empty(response);
    });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/session/session-1/prompt") {
    void readJson(request).then((parsed) => {
      const prompt = parsed.text ?? "";
      if (prompt.includes("unknown-support") && sessionModel?.variant !== undefined) {
        json(response, { _tag: "InvalidRequestError", message: "unexpected reasoning variant" }, 400);
        return;
      }
      if (prompt.includes("require-max-effort") && sessionModel?.variant !== "max") {
        json(response, { _tag: "InvalidRequestError", message: "provider-native effort was not preserved" }, 400);
        return;
      }
      const textSchema = portableSchema(sessionInstructions);
      const textOutput = textSchema
        ? JSON.stringify(synthesizeSchema(textSchema, textSchema, "", prompt))
        : "hello";
      const embeddedError = prompt.includes("embedded-auth-error")
        ? { type: "ProviderAuthError", message: "synthetic secret", status: 401 }
        : prompt.includes("embedded-free-tier-restriction")
          ? {
            type: "provider.auth",
            message: "Error from provider (Console): OpenCode's free tier can only be used from within OpenCode",
            status: 403,
          }
        : prompt.includes("embedded-rate-limit") || prompt === "rate-limit"
          ? { type: "APIError", message: "synthetic body", status: 429 }
          : prompt.includes("embedded-abort")
            ? { type: "MessageAbortedError", message: "synthetic abort details" }
            : prompt.includes("embedded-length")
              ? { type: "MessageOutputLengthError", message: "synthetic length" }
              : prompt.includes("embedded-structured")
                ? { type: "StructuredOutputError", message: "synthetic invalid JSON" }
                : prompt.includes("missing-model")
                  ? { type: "InvalidModelError", message: "model unavailable", status: 400 }
                  : undefined;
      assistantMessage = {
        id: "assistant-1",
        time: { created: Date.now(), completed: Date.now() },
        type: "assistant",
        agent: "switchy",
        model: sessionModel,
        content: [{ type: "text", text: textOutput }],
        finish: "stop",
        tokens: { input: 6, output: 3, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
        error: embeddedError,
      };
      const complete = () => {
        emit({ id: "delta", created: Date.now(), type: "session.text.delta", data: {
          sessionID: "session-1", assistantMessageID: "assistant-1", ordinal: 0, delta: textOutput,
        } });
        if (prompt.includes("close-event-stream")) {
          for (const stream of streams) stream.end();
        } else if (embeddedError) {
          emit({ id: "failed", created: Date.now(), type: "session.execution.failed", durable: {
            aggregateID: "session-1", seq: 1, version: 1,
          }, data: { sessionID: "session-1", error: embeddedError } });
        } else {
          emit({ id: "succeeded", created: Date.now(), type: "session.execution.succeeded", durable: {
            aggregateID: "session-1", seq: 1, version: 1,
          }, data: { sessionID: "session-1" } });
        }
      };
      if (prompt.includes("slow")) {
        // Cancellation completes this request through the interrupt endpoint.
      } else if (prompt.includes("medium-delay")) {
        setTimeout(complete, 150);
      } else {
        complete();
      }
      json(response, { data: {
        id: "inbox-1", sessionID: "session-1", timeCreated: Date.now(), type: "user",
        payload: { text: prompt }, delivery: "steer",
      } });
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/session/session-1/context") {
    json(response, { data: assistantMessage ? [assistantMessage] : [] });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/session/session-1/interrupt") {
    json(response, { interrupted: true });
    return;
  }
  if (request.method === "DELETE" && url.pathname === "/api/session/session-1") {
    deletedSessions += 1;
    sessionExists = false;
    sessionInstructions = "";
    sessionModel = undefined;
    assistantMessage = undefined;
    empty(response);
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
