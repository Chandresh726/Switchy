#!/usr/bin/env node

import readline from "node:readline";
import { appendFileSync } from "node:fs";

if (process.env.SWITCHY_FAKE_CLI_AUDIT_PATH) {
  appendFileSync(
    process.env.SWITCHY_FAKE_CLI_AUDIT_PATH,
    `${JSON.stringify({ cli: "codex", argv: process.argv.slice(2) })}\n`
  );
}

const requiredDisabledFeatures = [
  "apps",
  "browser_use",
  "computer_use",
  "hooks",
  "multi_agent",
  "plugins",
  "shell_tool",
  "unified_exec",
];
const disabledFeatures = process.argv.flatMap((argument, index, args) =>
  argument === "--disable" ? [args[index + 1]] : []
);
const processIsolationValid = requiredDisabledFeatures.every((feature) =>
  disabledFeatures.includes(feature)
) && process.argv.includes('web_search="disabled"') && process.argv.includes("mcp_servers={}");

if (process.argv.includes("--version")) {
  process.stdout.write("codex-cli 9.9.9\n");
  process.exit(0);
}

if (process.env.SWITCHY_FAKE_CODEX_INCOMPATIBLE === "1") {
  process.stderr.write("unsupported app-server options\n");
  process.exit(2);
}

if (process.env.SWITCHY_FAKE_CODEX_STARTUP_CRASH === "1") {
  process.exit(2);
}

const lines = readline.createInterface({ input: process.stdin });
let initialized = false;
const portableSchemas = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

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
    if (key === "jobId") {
      const match = prompt.match(/"jobId"\s*:\s*(\d+)/);
      return Number(match?.[1] ?? 1);
    }
    if (key === "score") return 88;
    return key.toLowerCase().includes("confidence") ? 0.95 : Math.max(1, resolved.minimum ?? 1);
  }
  if (type === "boolean") return false;
  if (type === "null") return null;
  if (key === "value") return "structured";
  if (key === "name") return "Alex Candidate";
  if (key === "startDate" || key === "endDate") return "2025-01";
  return "Synthetic evidence";
}

const coverLetter = `I am excited to apply for this engineering role because my experience building reliable TypeScript applications aligns well with the work described. In my recent position, I delivered maintainable product features, collaborated closely with teammates, and improved systems through careful testing and practical technical decisions.

My background includes modern web development, API design, debugging, and clear communication across product and engineering partners. I focus on understanding the real problem, choosing simple solutions, and following work through production. These habits would help me contribute quickly while continuing to learn the team domain.

I would welcome the opportunity to discuss how my experience and thoughtful approach could support the organization. Thank you for considering my application. I look forward to learning more about the role and the challenges the team is solving.`;

lines.on("line", (line) => {
  const message = JSON.parse(line);
  const { id, method, params = {} } = message;
  if (id === undefined) return;

  if (method === "initialize") {
    if (process.env.SWITCHY_FAKE_CODEX_HANG_INITIALIZE === "1") return;
    setTimeout(() => {
      initialized = true;
      send({ id, result: { serverInfo: { name: "fake-codex", version: "9.9.9" } } });
    }, 20);
    return;
  }
  if (!initialized) {
    send({ id, error: { code: -32000, message: "request before initialized" } });
    return;
  }
  if (method === "account/read") {
    send({
      id,
      result: process.env.SWITCHY_FAKE_CODEX_AUTH_NOT_REQUIRED === "1"
        ? { account: null, requiresOpenaiAuth: false }
        : { account: { type: "chatgpt" }, requiresOpenaiAuth: true },
    });
    return;
  }
  if (method === "model/list") {
    if (!params.cursor) {
      send({
        id,
        result: {
          data: [
            {
              id: "visible",
              model: "gpt-visible",
              displayName: "Visible GPT",
              description: "Text model",
              hidden: false,
              isDefault: true,
              inputModalities: ["text"],
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "minimal" },
                { reasoningEffort: "low" },
                { reasoningEffort: "medium" },
                { reasoningEffort: "high" },
                { reasoningEffort: "xhigh" },
                { reasoningEffort: "max" },
                { reasoningEffort: "future_v1" },
              ],
            },
            {
              id: "hidden",
              model: "gpt-hidden",
              displayName: "Hidden",
              hidden: true,
              isDefault: false,
              inputModalities: ["text"],
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [],
            },
            {
              id: "normalized",
              model: "gpt-normalized",
              displayName: "Normalized GPT",
              hidden: false,
              isDefault: false,
              inputModalities: ["text"],
              defaultReasoningEffort: "medium",
              supportedReasoningEfforts: [
                { reasoningEffort: "low" },
                { reasoningEffort: "high" },
                { reasoningEffort: "xhigh" },
              ],
            },
          ],
          nextCursor: "page-2",
        },
      });
      return;
    }
    send({
      id,
      result: {
        data: [{
          id: "audio",
          model: "audio-only",
          displayName: "Audio",
          hidden: false,
          isDefault: false,
          inputModalities: ["audio"],
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [],
        }],
        nextCursor: null,
      },
    });
    return;
  }
  if (method === "thread/start") {
    const unsupportedThreadFields = [
      "allowProviderModelFallback",
      "dynamicTools",
      "environments",
      "runtimeWorkspaceRoots",
      "selectedCapabilityRoots",
    ];
    if (unsupportedThreadFields.some((field) => Object.hasOwn(params, field))) {
      send({ id, error: { code: -32602, message: "invalid params: unsupported thread field" } });
      return;
    }
    if (process.env.SWITCHY_FAKE_CODEX_INVALID_PARAMS === "1") {
      send({ id, error: { code: -32602, message: "invalid params" } });
      return;
    }
    if (params.developerInstructions?.includes("require late interrupt") &&
        !globalThis.lateTurnInterrupted) {
      send({ id, error: { code: -32002, message: "late turn was not interrupted" } });
      return;
    }
    if (params.developerInstructions?.includes("require fresh process") &&
        globalThis.hadTurn) {
      send({ id, error: { code: -32003, message: "old process was not retired" } });
      return;
    }
    const config = params.config ?? {};
    const isolated = processIsolationValid &&
      params.sandbox === "read-only" &&
      params.approvalPolicy === "never" &&
      config.web_search === "disabled" &&
      config.features?.shell_tool === false &&
      config.features?.unified_exec === false &&
      config.features?.multi_agent === false &&
      Object.keys(config.mcp_servers ?? {}).length === 0;
    if (!isolated) {
      send({ id, error: { code: -32001, message: "isolation missing" } });
      return;
    }
    const threadId = `thread-${id}`;
    const schemaText = params.developerInstructions
      ?.split("JSON SCHEMA:\n")[1]
      ?.split("\n\nSECURITY BOUNDARY:")[0]
      ?.trim();
    if (schemaText) {
      try {
        portableSchemas.set(threadId, JSON.parse(schemaText));
      } catch {
        // Malformed schemas are handled as ordinary text in this fake.
      }
    }
    const respond = () => send({ id, result: { thread: { id: threadId } } });
    if (params.developerInstructions?.includes("delay setup")) {
      setTimeout(respond, 500);
    } else {
      respond();
    }
    return;
  }
  if (method === "turn/start") {
    if (Object.hasOwn(params, "environments") || Object.hasOwn(params, "runtimeWorkspaceRoots")) {
      send({ id, error: { code: -32602, message: "invalid params: unsupported turn field" } });
      return;
    }
    const turnPrompt = params.input?.map((item) => item.text ?? "").join("") ?? "";
    if (turnPrompt.includes("require-max-effort") && params.effort !== "max") {
      send({ id, error: { code: -32602, message: "provider-native effort was not preserved" } });
      return;
    }
    globalThis.hadTurn = true;
    const turnId = `turn-${id}`;
    const prompt = params.input?.[0]?.text ?? "";
    if (prompt.includes("turn-auth-failure")) {
      send({ id, result: { turn: { id: turnId } } });
      send({ method: "turn/completed", params: {
        threadId: params.threadId,
        turn: { id: turnId, status: "failed", error: { codexErrorInfo: "unauthorized" } },
      } });
      return;
    }
    if (prompt.includes("crash")) {
      setTimeout(() => process.exit(2), 5);
      return;
    }
    const requestedSchema = params.outputSchema ?? portableSchemas.get(params.threadId);
    const output = requestedSchema
      ? prompt.includes("malformed")
        ? "not json"
        : JSON.stringify(synthesizeSchema(requestedSchema, requestedSchema, "", prompt))
      : prompt.includes("complete cover letter body")
        ? coverLetter
        : "streamed text";
    const complete = () => {
      send({ method: "item/agentMessage/delta", params: {
        threadId: params.threadId,
        turnId,
        itemId: "item-1",
        delta: output.slice(0, 8),
      } });
      send({ method: "item/agentMessage/delta", params: {
        threadId: params.threadId,
        turnId,
        itemId: "item-1",
        delta: output.slice(8),
      } });
      send({ method: "thread/tokenUsage/updated", params: {
        threadId: params.threadId,
        turnId,
        tokenUsage: { total: { inputTokens: 7, outputTokens: 3, totalTokens: 10 } },
      } });
      send({ method: "turn/completed", params: {
        threadId: params.threadId,
        turn: { id: turnId, status: "completed" },
      } });
    };
    const acknowledge = () => {
      send({ id, result: { turn: { id: turnId } } });
      if (prompt.includes("same-chunk") || prompt.includes("delayed-ack")) {
        complete();
      } else {
        setTimeout(complete, prompt.includes("slow") ? 500 : 5);
      }
    };
    if (prompt.includes("very-delayed-ack")) {
      setTimeout(acknowledge, 200);
    } else if (prompt.includes("delayed-ack")) {
      setTimeout(acknowledge, 100);
    } else {
      acknowledge();
    }
    return;
  }
  if (method === "turn/interrupt") {
    if (params.turnId) globalThis.lateTurnInterrupted = true;
    send({ id, result: {} });
    return;
  }
  send({ id, error: { code: -32601, message: "Method not found" } });
});
