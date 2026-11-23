import { parseArguments } from "./arguments.js";
import { doctorCommand, logsCommand, openCommand, restartCommand, startCommand, statusCommand, stopCommand, updateCommand, versionCommand } from "./commands.js";
import { DEFAULT_PORT, assertSupportedNodeVersion } from "./config.js";
import { lifecycleCommand } from "./lifecycle.js";

async function main(): Promise<void> {
  assertSupportedNodeVersion();
  const { command, values, startup } = parseArguments(process.argv.slice(2));
  switch (command) {
    case "start": await startCommand({
      version: values.get("--app-version") as string | undefined,
      port: values.has("--port") ? Number(values.get("--port")) : undefined,
      foreground: values.has("--foreground"),
    }); break;
    case "stop": await stopCommand(values.has("--force")); break;
    case "restart": await restartCommand(); break;
    case "status": await statusCommand(values.has("--json")); break;
    case "doctor": await doctorCommand(); break;
    case "startup": await lifecycleCommand(startup); break;
    case "update": await updateCommand(values.has("--check") ? "check" : values.has("--download") ? "download" : values.has("--apply") ? "apply" : "install"); break;
    case "logs": await logsCommand(); break;
    case "open": await openCommand(); break;
    case "version": versionCommand(); break;
    default: console.log(`Switchy CLI

Usage:
  switchy start [--port ${DEFAULT_PORT}] [--foreground] [--app-version <version>]
  switchy stop [--force]
  switchy restart
  switchy status [--json]
  switchy doctor
  switchy update [--check | --download | --apply]
  switchy startup enable|disable|status
  switchy logs
  switchy open
  switchy version`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
