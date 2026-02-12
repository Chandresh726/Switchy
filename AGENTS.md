# AGENTS.md

Guidelines for AI coding agents working in this repository.

## Project Overview

Switchy is a local-first job scraping, matching, and tracking tool built with Next.js 16, TypeScript, Drizzle ORM (SQLite), and Shadcn UI. It scrapes jobs from platforms like Greenhouse/Lever/Ashby, matches them to resumes using AI, and tracks applications locally.

## Build/Lint/Test Commands

```bash
# Build
pnpm build            # Production build
pnpm start            # Start production server

# Linting
pnpm lint             # Run ESLint (no separate typecheck command - TypeScript is checked via ESLint)

# Database (Drizzle ORM)
pnpm db:generate      # Generate migrations from schema changes
pnpm db:migrate       # Apply migrations to local SQLite DB
pnpm db:studio        # Open Drizzle Studio to inspect data

# Testing
# No tests currently configured. If adding tests, check package.json first.
```

## Agent Execution Rules

- **NEVER run `pnpm dev`** - the dev server is a long-running process not suitable for agent execution
- For verification, use `pnpm lint` and `pnpm build` only
- Do not start any long-running processes or servers

## Package Manager

- Uses **pnpm** exclusively. Never use npm or yarn.
- Run `pnpm install` after pulling changes with new dependencies.

## Code Style Guidelines

### Imports

Order imports as follows, separated by blank lines:

1. React/Next.js imports
2. External library imports (third-party packages)
3. Internal imports using `@/` path alias
4. Relative imports (same directory or parent)

```typescript
import type { Metadata } from "next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { Button } from "./button";
```

Use `import type` for type-only imports.

### TypeScript

- **Strict mode is enabled** - all code must pass strict type checking
- Use `type` for type definitions, `interface` for object shapes that may be extended
- Prefer type inference where obvious, explicit types for function parameters and returns
- Use `Record<string, unknown>` for loosely-typed objects, not `any`
- Union types for string literals (e.g., `"remote" | "hybrid" | "onsite"`)

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Variables/Functions | camelCase | `fetchJobs`, `totalCount` |
| Components | PascalCase | `JobCard`, `MatchBadge` |
| Types/Interfaces | PascalCase | `Job`, `ScraperResult` |
| Constants | SCREAMING_SNAKE_CASE | `STATUS_COLORS`, `AI_SETTING_KEYS` |
| Files | kebab-case | `job-card.tsx`, `base-scraper.ts` |
| Database tables | camelCase (in schema) | `scrapeSessions`, `jobRequirements` |

### React Components

- Use functional components with arrow functions
- Use `"use client"` directive at the top of client components
- Destructure props in the function signature with an interface

```typescript
"use client";

import { useState } from "react";

interface JobCardProps {
  job: Job;
  onStatusChange?: (status: string) => void;
}

export function JobCard({ job, onStatusChange }: JobCardProps) {
  // ...
}
```

### API Routes (Next.js App Router)

- Located in `app/api/` directory
- Export async functions for HTTP methods: `GET`, `POST`, `PATCH`, `DELETE`
- Always wrap in try/catch and return appropriate error responses

```typescript
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    // Implementation
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Failed to fetch:", error);
    return NextResponse.json(
      { error: "Failed to fetch" },
      { status: 500 }
    );
  }
}
```

### Database (Drizzle ORM)

- Schema defined in `lib/db/schema.ts`
- Use `$inferSelect` for select types, `$inferInsert` for insert types

```typescript
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
```

- Import `db` from `@/lib/db` for queries
- Use Drizzle query builder with operators from `drizzle-orm`

### Error Handling

- Use try/catch in async operations
- Log errors with `console.error()` including context
- Return user-friendly error messages, not raw error details
- For AI operations, use the custom `AIError` class from `lib/ai/providers/types.ts`

```typescript
import { AIError } from "@/lib/ai/providers/types";

throw new AIError("missing_api_key", "API key is required for this provider");
```

### Styling

- Tailwind CSS for all styling
- Use the `cn()` utility from `@/lib/utils` for conditional class merging
- Dark mode is default (app uses `className="dark"` on html element)
- Shadcn UI components in `components/ui/` - use these for consistent UI

```typescript
import { cn } from "@/lib/utils";

<div className={cn("base-classes", condition && "conditional-class")} />
```

### File Organization

```
app/
  (dashboard)/       # Route group for authenticated pages
  api/               # API routes
  layout.tsx         # Root layout
lib/
  ai/                # AI providers and matching logic
  db/                # Database schema and connection
  hooks/             # Custom React hooks
  scrapers/          # Job board scrapers
  utils.ts           # Shared utilities (cn function)
components/
  ui/                # Shadcn UI components
  [feature]/         # Feature-specific components
```

## Data Storage

- SQLite database stored in `~/.switchy/switchy.db`
- User uploads (resumes) stored in `~/.switchy/uploads/`
- API keys stored in local SQLite, never committed to git

## Common Patterns

### Server Actions

Use `"use server"` directive for server actions:

```typescript
"use server";

import { db } from "@/lib/db";

export async function myAction(formData: FormData) {
  // Server-side logic
}
```

### TanStack Query Mutations

```typescript
const mutation = useMutation({
  mutationFn: async (data) => {
    const res = await fetch("/api/endpoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed");
    return res.json();
  },
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["resource"] });
  },
});
```

### ESLint Rules

- ESLint config: `eslint.config.mjs`
- Uses `eslint-config-next` (includes TypeScript rules)
- Run `pnpm lint` before committing changes

## Key Dependencies

- `next` - Framework (App Router)
- `drizzle-orm` - Database ORM
- `@tanstack/react-query` - Server state management
- `ai` - Vercel AI SDK for LLM integration
- `zod` - Schema validation
- `lucide-react` - Icons
- `radix-ui` + `shadcn` - UI components
