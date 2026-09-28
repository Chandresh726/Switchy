#!/usr/bin/env node
/**
 * Fallback wake for the Switchy scheduler, suitable for cron or launchd
 * `StartInterval` execution.
 *
 * It only pokes the local server's recovery endpoint. If the server is down,
 * the poke fails silently and the server's own boot recovery coalesces the
 * missed run when the KeepAlive agent restarts it.
 *
 * The DB lease in `scheduler-lease-store` guarantees a tick never double-runs
 * alongside the in-process node-cron batch.
 */
const port = Number.parseInt(process.env.SWITCHY_PORT ?? "6767", 10) || 6767;
const url = `http://127.0.0.1:${port}/api/scheduler/recover`;

try {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  const response = await fetch(url, {
    method: "POST",
    headers: { "X-Switchy-Request": "true" },
    signal: controller.signal,
  });
  clearTimeout(timeout);
  if (!response.ok) {
    console.error(`Scheduler tick: server responded ${response.status}`);
  }
} catch (error) {
  console.error(`Scheduler tick: server unreachable (${error instanceof Error ? error.message : String(error)})`);
}
