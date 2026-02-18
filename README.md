# Switchy

A local-first job scraping, matching, and tracking tool. Switchy discovers roles from job platforms, matches them to your resume using AI, and helps you track applications—all running locally on your machine.

## What it does

- **Scrape jobs** from platforms like Greenhouse, Lever, and Ashby
- **Parse resumes** and match them to jobs using AI
- **Track applications** with a local SQLite database
- **Tune matching** via a settings UI—batch size, concurrency, timeouts, AI models

## Prerequisites

- **Node.js**: v20+
- **pnpm**: package manager
- **Native build tools**: for `better-sqlite3` (Python, C++ compiler)
- **AI API key** (optional): Anthropic, Google Gemini, or other supported providers
- **Playwright browsers** (optional): Required only for Workday scraper - run `pnpm exec playwright install`

## Local Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start the dev server
pnpm dev
```

Open `http://localhost:3000` and configure your AI provider in Settings.

Switchy now auto-runs database migrations before `pnpm dev` and `pnpm start`, and auto-manages an encryption secret in `~/.switchy/` on first run. No `.env` setup is required for local use.

- `pnpm dev` uses development state: `~/.switchy/dev/`
- `pnpm start` uses production state: `~/.switchy/`

### Production Build

```bash
# Build for production
pnpm build

# Start production server
pnpm start
```

### Database Commands

| Command | Description |
|---------|-------------|
| `pnpm db:generate` | Generate migrations from schema |
| `pnpm db:migrate` | Apply migrations to local DB |
| `pnpm db:studio` | Open Drizzle Studio to inspect data |

## Supported AI Providers

| Provider | Authentication |
|----------|----------------|
| **Anthropic (Claude)** | API key |
| **Google (Gemini)** | API key or Gemini CLI OAuth |
| **OpenAI** | API key |
| **Cerebras** | API key |
| **OpenRouter** | API key |

Configure providers in the Settings page. API keys are stored locally in SQLite and never committed to git.

---

**Note**: Data is stored in `~/.switchy/` (SQLite DB, uploads, and local settings). All personal data stays local and outside the project directory.
