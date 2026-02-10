## Switchy

Switchy is a local-first job scraping, matching, and tracking tool built with **Next.js 16 (App Router)**, **React 19**, **Drizzle ORM**, and **SQLite**. It can:

- Discover roles from platforms like **Greenhouse** and **Lever**
- Store jobs in a local SQLite database
- Parse resumes and match them to jobs using **Anthropic (Claude)** or **Google Gemini**
- Let you tune matching behavior (bulk matching, concurrency, timeouts, etc.) from a rich settings UI

This app is designed to run **locally on your machine**; no hosted backend is required.

---

## Tech Stack

- **Framework**: Next.js 16 (App Router, RSC)
- **Language**: TypeScript
- **Database**: SQLite via `better-sqlite3` and **Drizzle ORM**
- **UI**: shadcn/ui, Tailwind CSS v4, Lucide icons
- **State / Data**: React Query, Zustand
- **AI Providers**:
  - Anthropic via `@ai-sdk/anthropic`
  - Google Gemini via `@ai-sdk/google` or `ai-sdk-provider-gemini-cli`

---

## Prerequisites

- **Node.js**: v20+ recommended
- **pnpm**: used as the package manager (a `pnpm-lock.yaml` is committed)
- Ability to install native modules (for `better-sqlite3`)

Optional (for AI features):
- **Anthropic API key** (Claude)
- **Google Gemini API key** or **Gemini CLI** (`gemini auth login`) for OAuth-based auth

---

## Installation

Clone the repository and install dependencies:

```bash
pnpm install
```

This will install all app and dev dependencies defined in `package.json`.

---

## Local Database

Switchy uses a local SQLite database (by default referenced as `data/switchy.db`).

- The `data/` directory is **gitignored** so your personal data and any stored API keys will **not** be pushed to GitHub.
- Migrations are managed via **Drizzle** (see `drizzle.config.ts` and the `drizzle/` folder).

To apply migrations (example):

```bash
pnpm drizzle-kit generate
# and/or, depending on your workflow
pnpm drizzle-kit migrate
```

Adjust the exact commands above to match how you prefer to run Drizzle; the config file in this repo determines the actual DB connection.

---

## Running the App

Start the development server:

```bash
pnpm dev
```

Then open `http://localhost:3000` in your browser.

Key areas of the app:

- `/(dashboard)` routes: main dashboard, job list, and settings
- `/settings`: configure AI provider, concurrency, batch size, and other matching parameters
- `data/switchy.db`: local SQLite DB used by the app (created on first run)

---

## Configuring AI Providers

All AI-related configuration is stored in the **settings** table in the local database and edited through the **Settings** page in the UI. There are no real API keys committed to the repo.

From the **Settings** page you can:

- Choose **AI provider**:
  - `Anthropic (Claude)` using an Anthropic API key
  - `Google (Gemini)` using either:
    - An API key from Google AI Studio
    - OAuth-based auth / Gemini CLI from your local machine
- Set:
  - `matcher_model` and resume parser model
  - Bulk matching on/off, batch size
  - Max retries, concurrency
  - Timeouts and circuit breaker thresholds

**Security note:** Your API keys and any OAuth tokens are stored locally in the SQLite DB and are never committed to git (the `data/` folder is ignored).

---

## Environment & Secrets

This project is configured to avoid leaking secrets:

- `.env*` files are **ignored** by git via `.gitignore`
- The `data/` folder is **ignored**, so any runtime data and secrets stored in the DB stay local
- `.cursor/`, `.claude/`, `.vscode`, and `.idea` are ignored to avoid committing editor/IDE state
- No real API keys or passwords are hardcoded in the source

If you want to document required environment variables for deployments, you can add an `.env.example` file with placeholder values (this example file is safe to commit as long as it has no real secrets).

---

## Production / Deployment

This app is primarily intended for **local use** with a local SQLite DB.

If you choose to deploy:

- Use a managed SQL database (or remote SQLite) instead of a local file.
- Make sure **real API keys** are passed via environment variables in your hosting provider.
- Confirm that `data/` and any local-only directories stay out of your deployment artifacts.

Build the app:

```bash
pnpm build
pnpm start
```

---

## Security & GitHub Readiness

This repository is configured to be safe to publish:

- `.env*`, `data/`, and editor/IDE directories are ignored in `.gitignore`
- There are **no committed secrets** or private keys in the codebase
- The SQLite database and any tokens it contains are **local-only**

Before making the repo public:

- Double-check you have not manually added any secret values into source files or committed an `.env` file.
- Optionally add a `LICENSE` file (MIT, Apache-2.0, etc.) to clarify how others can use this project.

---

## License

No explicit open-source license has been chosen yet.  
If you intend to open-source this project, add a `LICENSE` file (for example, MIT) to clarify usage terms.
