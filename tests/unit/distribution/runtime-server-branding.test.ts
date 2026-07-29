import { describe, expect, it } from "vitest";

import { brandStandaloneServer } from "../../../scripts/runtime-server-branding.mjs";

describe("packaged runtime server branding", () => {
  it("sets the Switchy title after the generated Next.js server starts", () => {
    const generatedServer = [
      'process.title = "node";',
      "startServer({",
      '  hostname: "127.0.0.1",',
      "  port: 6767,",
      "});",
    ].join("\n");

    const brandedServer = brandStandaloneServer(generatedServer);

    expect(brandedServer).toBe(
      `${generatedServer}\n\nprocess.title = "Switchy";\n`
    );
  });

  it("does not add the title more than once", () => {
    const brandedServer = brandStandaloneServer("startServer({});");

    expect(brandStandaloneServer(brandedServer)).toBe(brandedServer);
  });
});
