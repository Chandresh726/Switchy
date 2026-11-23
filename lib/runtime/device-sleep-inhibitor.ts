import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const CAFFEINATE_PATH = "/usr/bin/caffeinate";
const MAX_RESTART_DELAY_MS = 30_000;

export interface DeviceSleepInhibitorLease {
  release(): Promise<void>;
}

export interface DeviceSleepInhibitor {
  acquire(): Promise<DeviceSleepInhibitorLease>;
}

type SpawnProcess = (command: string, args: string[]) => ChildProcess;
type ConfirmAssertion = (child: ChildProcess) => Promise<boolean>;

async function confirmAssertion(child: ChildProcess): Promise<boolean> {
  if (!child.pid) return false;
  const deadline = Date.now() + 2_000;
  do {
    const { stdout } = await execute("/usr/bin/pmset", ["-g", "assertions"], { timeout: 2_000 });
    if (stdout.split("\n").some((line) =>
      line.includes(`pid ${child.pid}(caffeinate):`) && line.includes("PreventUserIdleSystemSleep")
    )) return true;
    if (child.exitCode !== null || child.killed) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return false;
}

export class CaffeinateDeviceSleepInhibitor implements DeviceSleepInhibitor {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = (command, args) =>
      spawn(command, args, { stdio: "ignore" }),
    private readonly confirm: ConfirmAssertion = confirmAssertion
  ) {}

  async acquire(): Promise<DeviceSleepInhibitorLease> {
    if (this.platform !== "darwin") return { release: async () => undefined };

    let activeProcess: ChildProcess | null = null;
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    let restartDelayMs = 1_000;
    let released = false;

    const stopProcess = (child: ChildProcess | null) => {
      if (!child || child.killed || child.exitCode !== null) return;
      try {
        child.kill();
      } catch (error) {
        console.warn("[DeviceSleepInhibitor] Failed to stop caffeinate assertion:", error);
      }
    };

    const scheduleRestart = () => {
      if (released || restartTimer || activeProcess) return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        void startAssertion();
      }, restartDelayMs);
      restartTimer.unref();
      restartDelayMs = Math.min(MAX_RESTART_DELAY_MS, restartDelayMs * 2);
    };

    const startAssertion = async () => {
      if (released || activeProcess) return;
      let child: ChildProcess | null = null;
      try {
        // The assertion lasts for this lease, and -w also bounds it to the
        // server lifetime if the server crashes before releasing the lease.
        child = this.spawnProcess(CAFFEINATE_PATH, ["-i", "-w", String(process.pid)]);
        activeProcess = child;
        const current = child;
        const spawned = new Promise<void>((resolve, reject) => {
          current.once("spawn", resolve);
          current.once("error", reject);
          current.once("exit", () => reject(new Error("Caffeinate exited before acquisition")));
        });
        const onFailure = () => {
          if (released || activeProcess !== current) return;
          activeProcess = null;
          console.warn("[DeviceSleepInhibitor] Caffeinate exited; restoring sleep protection.");
          stopProcess(current);
          scheduleRestart();
        };
        current.once("exit", onFailure);
        current.once("error", onFailure);
        current.unref();
        await spawned;
        if (released || activeProcess !== current) return;
        const confirmed = await this.confirm(current);
        if (released || activeProcess !== current) return;
        if (!confirmed) throw new Error("macOS did not confirm the sleep assertion");
        restartDelayMs = 1_000;
      } catch (error) {
        if (child && activeProcess !== child) return;
        if (activeProcess === child) {
          activeProcess = null;
          stopProcess(child);
        }
        if (!released) {
          console.warn("[DeviceSleepInhibitor] Failed to start caffeinate assertion:", error);
          scheduleRestart();
        }
      }
    };

    await startAssertion();
    return {
      release: async () => {
        if (released) return;
        released = true;
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = null;
        const child = activeProcess;
        activeProcess = null;
        stopProcess(child);
      },
    };
  }
}

export function createDeviceSleepInhibitor(): DeviceSleepInhibitor {
  return new CaffeinateDeviceSleepInhibitor();
}
