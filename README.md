# Switchy

Switchy is a local-first job scraping, matching, and tracking app built with Next.js, TypeScript, Drizzle ORM (SQLite), and Shadcn UI.

It helps you discover jobs from multiple ATS platforms, match them against your profile/resume with AI, generate outreach content, and track everything locally.

## Run Switchy

After the stable package is published, users only need Node.js 24:

```bash
npx @chandresh726/switchy@latest start
npx @chandresh726/switchy@latest status
npx @chandresh726/switchy@latest stop
```

The first start downloads and checksum-verifies the runtime for the current
operating system, installs the required Chromium build, migrates the local
database, and starts Switchy on
[http://127.0.0.1:6767](http://127.0.0.1:6767). Later starts reuse the local
runtime. Run `npx @chandresh726/switchy@latest update` to install the latest
stable application release.

## Current Capabilities

- Scrape jobs from `Greenhouse`, `Lever`, `Ashby`, `Eightfold`, `Workday`, `ServiceNow`, `TurboHire`, `MynextHire`, `Uber`, `Google`, `Atlassian`, `Rippling`, `Visa`, `Jobvite`, `TalentBrew`, `Oracle Recruiting`, and `Phenom`
- Track companies (single and bulk operations), with support for custom career pages + manual ATS override
- Manage a job pipeline with filters, search, sorting, saved/applied tabs, and match score views
- Upload and parse resumes, then manage profile, skills, experience, and education data
- Configure evidence-based AI matching with Economy, Balanced, or Quality presets and advanced retry, concurrency, and timeout controls
- Generate AI referral messages and cover letters per job, with editable AI history
- Run scheduled scraping through a crash-recoverable local queue and review scrape/match/AI histories
- Receive native macOS alerts for strong matches found by automatic scrape runs
- Keep data local in `~/.switchy` (database, uploads, encryption secret)

## Supported AI Providers

- Anthropic
- OpenAI
- Google Gemini
- OpenRouter
- Cerebras
- Groq
- NVIDIA (NIM)
- Codex CLI (uses the CLI's existing login; no credential is stored by Switchy)
- OpenCode (uses OpenCode's existing provider configuration; no credential is stored by Switchy)

## Prerequisites

- Node.js `v24`
- Internet access on first CLI start (the runtime and Playwright Chromium are
  downloaded automatically)
- AI provider credentials (optional, only required for AI-powered features)
- Optional local CLI provider: an installed and authenticated `codex` or `opencode` executable
- Native job-match notifications require macOS 12 or newer; other platforms
  report notifications as unavailable

Source development additionally requires `pnpm` and native build tools for
`better-sqlite3`. On macOS, `pnpm dev` also builds a headless Switchy
notification helper automatically; it does not install a separate application.

## Source Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Switchy intentionally binds to `127.0.0.1` and accepts connections only from
the same device. It is not a LAN or internet-facing service, and the local
request marker used by browser mutations is request-integrity protection rather
than a user authentication system.

## Production

```bash
pnpm build
pnpm start
```

Database migrations run automatically before `pnpm dev` and `pnpm start`.
Production mode is also bound to `127.0.0.1`; use it only from the device where
Switchy is running.

Job and people search intentionally use bounded SQLite substring queries. This
keeps the local installation and generated migration chain simple. Revisit an
FTS index only if a representative local database of at least 50,000 jobs has a
repeatable search latency above 250 ms on supported hardware; until then,
bounded query text and paginated responses are the preferred tradeoff.

## Data Storage

- Development data: `~/.switchy/data/development/`
- Production data: `~/.switchy/data/production/`
- Installed application versions: `~/.switchy/app/versions/`
- Process metadata: `~/.switchy/runtime/`
- Logs: `~/.switchy/logs/`
- Download and browser caches: `~/.switchy/cache/`
- Automatic update and migration snapshots: `~/.switchy/update-snapshots/`

Each data directory contains its own `switchy.db`, `uploads/`, and
`encryption.secret`. Existing `~/.switchy` and `~/.switchy/dev` data is
snapshotted and moved into this unified layout automatically on the first
start. No `.env` setup is required for standard local usage.

## Scraper Internals

Scraping is API-first with direct HTTP and browser fallbacks where a platform requires them. Manual refreshes, scheduled runs, retries, cancellation, and restart recovery share a durable SQLite work queue. See [Scraper Architecture](docs/scraper-architecture.md) for the platform decision tree, reliability guarantees, tuning, and recovery runbook.

## AI Internals

AI execution, evidence-based matching, grounded writing, resume parsing, privacy boundaries, and queue recovery are described in [AI Architecture](docs/ai-architecture.md).

## Backend Internals

The local API, request contracts, application-service boundaries, SQLite
transactions, automatic migrations, filesystem ownership, health reporting, and
recovery procedures are described in [Backend Architecture](docs/backend-architecture.md).

Every JSON endpoint validates path, query, request, and client-consumed response
data with shared Zod contracts. Failures use a stable envelope containing
`error`, `code`, optional `details`, and `requestId`; the same request ID is
returned in the `x-request-id` header. Mutation requests additionally require
same-origin local request validation and the `x-switchy-request` marker.

The browser-side contract flow, typed feature-client rule, query-cache
ownership, error/request-ID behavior, streaming and download exceptions, and
the route compatibility matrix are documented in
[Frontend API Integration](docs/frontend-integration.md). Runtime readiness,
database status, scheduler initialization, and queue recovery are shown in the
existing Settings System Info card.

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start local app (development mode) |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm distribution:verify` | Verify the CLI and local-layout distribution contracts |
| `pnpm runtime:package` | Package the current platform's standalone runtime |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Run TypeScript without emitting files |
| `pnpm deadcode` | Reject unused root-app files, exports, and dependencies |
| `pnpm test:run` | Run tests once |
| `pnpm audit` | Check all production and development dependencies |
| `pnpm audit:prod` | Check shipped dependencies for known vulnerabilities |
| `pnpm verify` | Run lint, typecheck, tests, production audit, and production build |
| `pnpm verify:all` | Run root verification plus landing app verification |
| `pnpm ai:eval` | Run deterministic AI matching, writing, and resume evaluations |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm state:backup -- --environment production\|development --output <directory>` | Create and verify a local-state snapshot |
| `pnpm state:backup:verify -- --from <snapshot-directory>` | Verify an existing snapshot without restoring it |
| `pnpm state:restore -- --environment production\|development --from <snapshot-directory> --replace` | Replace stopped local state from a verified snapshot |

## Encryption Secret

Switchy stores the API-key encryption secret in the local state directory, not in `.env`:

- Development: `~/.switchy/data/development/encryption.secret`
- Production: `~/.switchy/data/production/encryption.secret`

Back up this file with the matching database. Losing it means stored provider API keys cannot be decrypted and must be re-entered.

## Local Backup and Recovery

Store snapshots outside the Switchy repository and outside `~/.switchy`. The
backup command uses SQLite's online backup API, so the database copy remains
consistent while Switchy is running. It then copies the uploads tree and the matching
encryption secret when that file exists, then verifies checksums and SQLite
integrity before reporting success. If any application database write occurs while
files are being copied, backup aborts without publishing a snapshot. Retry when
local write activity is idle, or stop Switchy first to guarantee a quiet backup.

```bash
pnpm state:backup -- --environment production --output ~/switchy-backups/production-2026-07-16
pnpm state:backup:verify -- --from ~/switchy-backups/production-2026-07-16
```

Use `development` for `~/.switchy/data/development`. A snapshot without an encryption secret
is valid only when the source state did not have one; stored encrypted provider
keys require the secret from the same snapshot.

Stop `pnpm dev` or `pnpm start` before restoring. Restore validates the source
before changing current state, builds and validates a sibling staging directory,
and requires `--replace` to make the destructive choice explicit:

```bash
pnpm state:restore -- --environment production --from ~/switchy-backups/production-2026-07-16 --replace
```

Before switching directories, restore creates a verified automatic rollback
snapshot under `~/.switchy/update-snapshots` and prints its location. Keep that
snapshot until the restored application starts successfully and the expected
profile, resumes, uploads, companies, and job history are present. If restore is
interrupted before activation or staged validation fails, the current state is
left unchanged. Production and development restore operate on separate data
directories.

## Local Health and Recovery

The health endpoints are local diagnostics and do not expose secrets or raw
error messages:

- `GET /api/health/live` confirms that the Next.js process can answer requests.
- `GET /api/health/ready` returns `200` only when SQLite, scheduler startup, and
  durable scrape/match recovery are ready; otherwise it returns `503`.
- `GET /api/health/runtime` reports sanitized queue age, expired lease count,
  recovery/dispatch timestamps, and the latest subsystem error code.

If readiness fails, stop the app before changing local state. Verify the latest
snapshot, restore it with `--replace` when database integrity or migrations are
the cause, then restart Switchy and recheck readiness. Provider availability is
nonessential and does not make the web application unready. See the
[Backend Architecture recovery runbook](docs/backend-architecture.md#recovery-runbook)
for the complete sequence.

## License

Switchy is available under the [MIT License](LICENSE).
