import os from "node:os";

export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function predatesCurrentBoot(startedAt?: string | number): boolean {
  try {
    return Boolean(startedAt && (typeof startedAt === "number" ? startedAt : Date.parse(startedAt)) < Date.now() - os.uptime() * 1000 - 10_000);
  } catch {
    // Restricted environments may not expose uptime. Retain the PID check.
    return false;
  }
}
