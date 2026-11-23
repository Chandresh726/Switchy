import { spawn } from "node:child_process";

import { getSwitchyPaths } from "./paths.js";
import { getRunningProcess } from "./process-manager.js";

export async function openCommand(): Promise<void> {
  const running = await getRunningProcess(getSwitchyPaths());
  if (!running?.live) throw new Error("Switchy is not running or is unresponsive");
  const url = `http://${running.record.hostname}:${running.record.port}`;
  const [executable, args] = process.platform === "darwin" ? ["open", [url]]
    : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(executable, args, { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  child.unref();
  console.log(url);
}

