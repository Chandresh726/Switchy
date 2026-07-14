import { spawn, type ChildProcess } from "node:child_process";

const CAFFEINATE_PATH = "/usr/bin/caffeinate";
const ASSERTION_TIMEOUT_SECONDS = 300;
const RENEWAL_INTERVAL_MS = 240_000;

export interface DeviceSleepInhibitorLease {
  release(): Promise<void>;
}

export interface DeviceSleepInhibitor {
  acquire(): Promise<DeviceSleepInhibitorLease>;
}

type SpawnProcess = (command: string, args: string[]) => ChildProcess;

class NoopDeviceSleepInhibitorLease implements DeviceSleepInhibitorLease {
  async release(): Promise<void> {}
}

export class CaffeinateDeviceSleepInhibitor implements DeviceSleepInhibitor {
  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly spawnProcess: SpawnProcess = (command, args) =>
      spawn(command, args, { stdio: "ignore" })
  ) {}

  async acquire(): Promise<DeviceSleepInhibitorLease> {
    if (this.platform !== "darwin") {
      return new NoopDeviceSleepInhibitorLease();
    }

    let activeProcess: ChildProcess | null = null;
    let released = false;

    const stopProcess = (child: ChildProcess | null) => {
      if (!child || child.killed) return;
      try {
        child.kill();
      } catch (error) {
        console.warn(
          "[DeviceSleepInhibitor] Failed to stop caffeinate assertion:",
          error
        );
      }
    };

    const startAssertion = () => {
      if (released) return;
      try {
        const nextProcess = this.spawnProcess(CAFFEINATE_PATH, [
          "-i",
          "-t",
          String(ASSERTION_TIMEOUT_SECONDS),
        ]);
        nextProcess.on("error", (error) => {
          console.warn(
            "[DeviceSleepInhibitor] Failed to start caffeinate assertion:",
            error
          );
        });
        nextProcess.unref();

        const previousProcess = activeProcess;
        activeProcess = nextProcess;
        stopProcess(previousProcess);
      } catch (error) {
        console.warn(
          "[DeviceSleepInhibitor] Failed to start caffeinate assertion:",
          error
        );
      }
    };

    startAssertion();
    const renewalTimer = setInterval(startAssertion, RENEWAL_INTERVAL_MS);
    renewalTimer.unref();

    return {
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(renewalTimer);
        stopProcess(activeProcess);
        activeProcess = null;
      },
    };
  }
}

export function createDeviceSleepInhibitor(): DeviceSleepInhibitor {
  return new CaffeinateDeviceSleepInhibitor();
}
