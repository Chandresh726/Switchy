const OPTIONS: Record<string, Record<string, "flag" | "value">> = {
  start: { "--port": "value", "--app-version": "value", "--foreground": "flag" },
  stop: { "--force": "flag" }, restart: {}, status: { "--json": "flag" },
  doctor: {}, update: { "--check": "flag", "--download": "flag", "--apply": "flag" },
  startup: {}, logs: {}, open: {}, version: {}, help: {},
};

export function parseArguments(args: string[]) {
  const command = args[0] ?? "help";
  if (args.includes("--help") || args.includes("-h")) return { command: "help", values: new Map<string, string | true>(), startup: "status" };
  const selected = command === "--version" || command === "-v" ? "version" : command;
  const options = Object.hasOwn(OPTIONS, selected) ? OPTIONS[selected] : undefined;
  if (!options) throw new Error(`Unknown command: ${command}`);
  const values = new Map<string, string | true>();
  let startup = "status";
  for (let index = 1; index < args.length; index++) {
    const name = args[index];
    if (selected === "startup" && index === 1 && ["enable", "disable", "status"].includes(name)) { startup = name; continue; }
    const kind = Object.hasOwn(options, name) ? options[name] : undefined;
    if (!kind) throw new Error(`Unknown option for ${selected}: ${name}`);
    if (values.has(name)) throw new Error(`Duplicate option: ${name}`);
    if (kind === "value") {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`${name} requires a value`);
      values.set(name, value);
    } else values.set(name, true);
  }
  if (selected === "update" && values.size > 1) throw new Error("Choose one update action: --check, --download, or --apply");
  const port = values.get("--port");
  if (typeof port === "string" && (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65_535)) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  return { command: selected, values, startup };
}
