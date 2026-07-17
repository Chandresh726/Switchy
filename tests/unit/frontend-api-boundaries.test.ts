import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

const readSource = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("frontend API source boundaries", () => {
  const frontendSources = [
    ...sourceFiles("app/(dashboard)"),
    ...sourceFiles("components"),
    ...sourceFiles("lib/hooks"),
    ...sourceFiles("lib/ai/writing/workspace"),
  ];

  it("keeps the generic transport and API paths inside typed feature clients", () => {
    for (const path of frontendSources) {
      const source = readSource(path);
      expect(source, path).not.toMatch(/from\s+["']@\/lib\/api\/client["']/);
      expect(source, path).not.toMatch(/["'`]\/api\//);
    }
  });

  it("keeps retired endpoint forms out of production browser code and feature clients", () => {
    const source = [
      ...frontendSources,
      ...sourceFiles("lib/api/clients"),
    ].map(readSource).join("\n");

    expect(source).not.toContain("/api/upload");
    expect(source).not.toMatch(/\/(?:match|scrape)-history\?sessionId=/);
    expect(source).not.toMatch(/\/api\/profile\/(?:skills|experience|education|resumes)\?id=/);
  });
});

describe("frontend API compatibility matrix", () => {
  it("lists every API route once with its complete method set", () => {
    const document = readSource("docs/frontend-integration.md");
    const rows = [...document.matchAll(/^\| `(\/api\/[^`]+)` \| ([^|]+) \|/gm)];
    const documented = new Map<string, Set<string>>();

    for (const row of rows) {
      const route = row[1];
      const methods = row[2];
      if (!route || !methods) continue;
      expect(documented.has(route), `duplicate matrix row for ${route}`).toBe(false);
      documented.set(route, new Set(methods.match(/GET|POST|PUT|PATCH|DELETE/g) ?? []));
    }

    const routeFiles = sourceFiles("app/api").filter((path) => path.endsWith("/route.ts"));
    const actual = new Map(routeFiles.map((path) => {
      const route = `/api/${relative("app/api", path).replace(/\/route\.ts$/, "")}`;
      const methods = new Set(
        [...readSource(path).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)/g)]
          .map((match) => match[1])
          .filter((method): method is string => Boolean(method))
      );
      return [route, methods] as const;
    }));

    expect([...documented.keys()].sort()).toEqual([...actual.keys()].sort());
    for (const [route, methods] of actual) {
      expect([...documented.get(route) ?? []].sort(), route).toEqual([...methods].sort());
    }
  });
});
