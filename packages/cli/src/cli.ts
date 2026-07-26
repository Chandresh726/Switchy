import {
  logsCommand,
  openCommand,
  startCommand,
  statusCommand,
  stopCommand,
  updateCommand,
  versionCommand,
} from "./commands.js";
import { assertSupportedNodeVersion } from "./config.js";

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function parsePort(args: string[]): number | undefined {
  const value = optionValue(args, "--port");
  if (!value) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return port;
}

function printHelp(): void {
  console.log(`Switchy CLI

Usage:
  switchy start [--port 3000] [--foreground] [--app-version <version>]
  switchy stop [--force]
  switchy status
  switchy update
  switchy logs
  switchy open
  switchy version`);
}

async function main(): Promise<void> {
  assertSupportedNodeVersion();
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  switch (command) {
    case "start":
      await startCommand({
        version: optionValue(args, "--app-version"),
        port: parsePort(args),
        foreground: args.includes("--foreground"),
      });
      break;
    case "stop":
      await stopCommand(args.includes("--force"));
      break;
    case "status":
      await statusCommand();
      break;
    case "update":
      await updateCommand();
      break;
    case "logs":
      await logsCommand();
      break;
    case "open":
      await openCommand();
      break;
    case "version":
    case "--version":
    case "-v":
      versionCommand();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
