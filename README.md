# Switchy

Switchy is a local-first job scraping, matching, and tracking app built with Next.js, TypeScript, Drizzle ORM (SQLite), and Shadcn UI.

It helps you discover jobs from multiple ATS platforms, match them against your profile/resume with AI, generate outreach content, and track everything locally.

## Current Capabilities

- Scrape jobs from `Greenhouse`, `Lever`, `Ashby`, `Eightfold`, and `Workday`
- Track companies (single and bulk operations), with support for custom career pages + manual ATS override
- Manage a job pipeline with filters, search, sorting, saved/applied tabs, and match score views
- Upload and parse resumes, then manage profile, skills, experience, and education data
- Configure AI-based matching (provider/model, reasoning effort, bulk mode, retry/concurrency/timeout tuning)
- Generate AI referral messages and cover letters per job, with editable AI history
- Run scheduled scraping (cron-based) and review scrape/match/AI histories
- Keep data local in `~/.switchy` (database, uploads, encryption secret)

## Supported AI Providers

- Anthropic
- OpenAI
- Gemini (API key)
- Gemini (CLI OAuth)
- OpenRouter
- Cerebras
- Modal
- Groq

## Prerequisites

- Node.js `v20+`
- `pnpm`
- Native build tools for `better-sqlite3` (Python + C/C++ toolchain)
- Internet access on first install (Playwright Chromium is auto-installed)
- AI provider credentials (optional, only required for AI-powered features)

## Local Setup

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Production

```bash
pnpm build
pnpm start
```

Database migrations run automatically before `pnpm dev` and `pnpm start`.

## Data Storage

- Development state: `~/.switchy/dev/`
  - DB: `~/.switchy/dev/switchy.db`
  - Uploads: `~/.switchy/dev/uploads/`
  - Encryption secret: `~/.switchy/dev/encryption.secret`
- Production state: `~/.switchy/`
  - DB: `~/.switchy/switchy.db`
  - Uploads: `~/.switchy/uploads/`
  - Encryption secret: `~/.switchy/encryption.secret`

No `.env` setup is required for standard local usage.

## Useful Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start local app (development mode) |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm db:generate` | Generate Drizzle migrations from schema changes |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm db:studio` | Open Drizzle Studio |
