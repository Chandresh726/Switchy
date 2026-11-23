import { lifecycleCommand } from "./lifecycle.js";

lifecycleCommand(process.argv[2] ?? "tick").catch((error: unknown) => {
  console.error("Switchy lifecycle failed:", error);
  process.exitCode = 1;
});
