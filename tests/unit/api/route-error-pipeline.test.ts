import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("API route error pipeline", () => {
  it("uses the unified error handler in every route", () => {
    const apiRoot = join(process.cwd(), "app/api");
    const routeFiles = readdirSync(apiRoot, { recursive: true })
      .filter((entry): entry is string =>
        typeof entry === "string" && entry.endsWith("route.ts")
      );
    expect(routeFiles.length).toBeGreaterThan(0);

    for (const routeFile of routeFiles) {
      const source = readFileSync(join(apiRoot, routeFile), "utf8");
      expect(source, routeFile).toContain("handleApiError");
      expect(source, routeFile).not.toContain("ai-error-handler");
      expect(source, routeFile).not.toMatch(
        /NextResponse\.json\([\s\S]*?\{\s*error\s*:/
      );
      expect(source, routeFile).not.toMatch(/^const\s+\w*Schema\s*=\s*z\./m);
      expect(source, routeFile).not.toMatch(/(?:Number\.)?parseInt\(/);
    }
  });

  it("does not bypass validated clients for internal API calls", () => {
    const roots = ["app", "components", "lib"];
    const offenders: string[] = [];

    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (path.includes(`${join("app", "api")}`)) continue;
          visit(path);
        } else if (/\.(?:ts|tsx)$/.test(entry.name)) {
          const source = readFileSync(path, "utf8");
          if (/fetch\(\s*[`'"]\/api\//.test(source)) offenders.push(path);
        }
      }
    };

    for (const root of roots) visit(join(process.cwd(), root));
    expect(offenders).toEqual([]);
  });
});
