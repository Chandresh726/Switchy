import { defineConfig } from "drizzle-kit";
import { ensureStateDir, getDbPath } from "./lib/state/paths";

ensureStateDir();

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: getDbPath(),
  },
});
