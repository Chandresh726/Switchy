# Scheduler reliability

The scraper schedule is backend-owned. The frontend only edits three settings
via `PATCH /api/settings`; it never schedules work.

| Setting | Key | Effect |
|---|---|---|
| Auto-scrape on/off | `scheduler_enabled` | Starts/stops the in-process cron task, installs/removes the macOS host agents |
| Schedule | `scheduler_cron` | Restarts the in-process cron task (`node-cron` validated) |
| Keep Mac awake | `scraper_keep_device_awake` | Holds a `caffeinate -i` assertion while auto-scrape is enabled (macOS only) |

## Backend layers

1. **In-process cron** (`lib/jobs/scheduler.ts`): `startScheduler()` registers
   `node-cron` at server boot (`instrumentation.ts`). Fires while the
   `next start` process is alive.
2. **Boot recovery** (`recoverSchedulerOnBoot`): on every server boot,
   `reconcileMissedRunsOnBoot()` enumerates cron occurrences since the last
   successful run — or since the latest already-tracked miss when recovery is
   pending, so earlier misses are never double-counted and later ones are
   still appended (capped at 50) — records them as `skipped` sessions with
   pending recovery, then runs one coalesced `scheduler_recovery` batch. No
   UI involvement. Turning auto-scrape off drops pending recovery; turning it
   on resets the baseline to now, so ticks from the disabled window are never
   backfilled.
3. **Watchdog** (`ensureSchedulerWatchdog` + `runSchedulerWatchdogTick`,
   every 120s): restarts a missing task when enabled and drains pending
   recovery. Never throws.
4. **Persistent idle-sleep assertion**: while the scheduler is enabled and
   keep-awake is on, the backend holds `caffeinate -i` for the whole enabled
   period (in addition to the per-dispatch assertion in
   `LocalScrapeQueueService`). Display may still sleep; lid-close still sleeps.
5. **macOS host agents** (`lib/jobs/scheduler-host.ts`):
   - `com.switchy.app`: `KeepAlive` + `RunAtLoad` wrapper around
     `pnpm start`, so the server (and layers 1-4) survives reboots and process
     exits. Logs to `~/.switchy/logs/switchy-server.*.log`. Installed on
     server boot and settings save; turning auto-scrape off removes only the
     tick agent below, never the app server itself.
   - `com.switchy.scheduler-tick`: `StartInterval` 300s `curl POST
     /api/scheduler/recover` fallback poke.
   - Synced automatically (best-effort, never fails a settings save) whenever
     `scheduler_enabled` / `scheduler_cron` / `scraper_keep_device_awake`
     changes and on every server boot, via `syncSchedulerHost()`. Agent
     health is verified with `launchctl print`, not just plist existence, so
     failed loads are retried and the badge never reports a dead install as
     working. Manage manually with
     `pnpm scheduler:host:{install,uninstall,status,sync}` or
     `POST /api/scheduler/host`.

## Concurrency

Manual runs, cron runs, boot recovery, watchdog ticks, and tick-script pokes
all share the `scheduler.lock` DB lease (5 min TTL, CAS) plus the in-process
`isRunning` guard, so overlapping triggers coalesce instead of double-scraping.

## Frontend role

- `ScraperSettings` edits the three settings above.
- `ScrapeCountdown` polls `GET /api/scheduler/status` (display only).
- `SchedulerRecoveryListener` is a best-effort hint that shortens the wait
  after sleep/wake when a tab happens to be open. Recovery works without it.

## Limitations

- Lid-closed Macs sleep; no software can run cron through that. Keep the
  machine on AC power with "Prevent automatic sleeping on power adapter".
- `scheduler-host` agents are macOS-only (`sync` returns `skipped` elsewhere).
- Very long downtimes coalesce into a single recovery batch by design.
