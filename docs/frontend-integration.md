# Frontend API Integration

Switchy's browser code follows one data path:

```text
page/component -> TanStack query or mutation -> typed feature client
               -> shared Zod contract -> Next.js API route
```

Pages, components, and hooks do not import `lib/api/client` or construct
`/api/*` URLs. Feature clients under `lib/api/clients` own path encoding,
canonical query serialization, local mutation markers, request validation, and
successful-response validation. API resource types are inferred from the same
contracts used by the routes; component-only view models are explicit mappings
from those types.

## Query and mutation ownership

All cache keys come from `lib/query-keys.ts`. Callers pass canonical parameter
objects, never serialized query strings. The `cacheOwnership` helpers define
the resource families invalidated by each successful mutation. A mutation must
update or invalidate every view that derives from the changed resource, while
session polling stops as soon as the contracted terminal state is observed.

## Failures and request references

The generic client throws `APIClientError` for structured API failures and for
invalid successful JSON. Existing page/card/empty-state patterns distinguish a
successful empty result from a failed request and provide retry where useful.
User-visible errors may show the sanitized backend message and request ID, but
never render `details`, stack traces, or raw server errors.

## Non-JSON success bodies

- AI generation is server-sent events. The feature client validates request
  data, the mutation marker, every delta/complete/error event, cancellation,
  and premature close. Active streams are aborted when their workspace unmounts.
- Resume download validates its path and structured JSON errors, then treats a
  successful body as a blob. The server filename is sanitized and the temporary
  object URL is always revoked.
- `/companies.json` is a packaged local asset, not a backend API endpoint.

## Adding or changing an endpoint

1. Change the shared request and response schemas under `lib/api/contracts`.
2. Update the route/application service and add a real service-to-contract test.
3. Add or update exactly one typed feature-client method.
4. Add a canonical query-key entry and mutation invalidation ownership when the
   resource is cached.
5. Consume the contract-derived type in the UI and handle pending, empty,
   failure, and success separately.
6. Update the compatibility matrix and run `pnpm verify:all`.

## Compatibility matrix

`JSON client` means a validated browser feature client owns the endpoint.
`Stream` and `download` are the documented non-JSON success exceptions.
`Probe` and `server-only` routes intentionally have no component caller.
Backup and restore are CLI-only package scripts and are not HTTP APIs.

| Route | Methods | Ownership | Browser boundary |
|---|---|---|---|
| `/api/ai/content/[id]` | PATCH, DELETE | JSON client | `clients/ai` |
| `/api/ai/content` | GET, DELETE; POST retained for non-stream callers | JSON client / server-only | `clients/ai` |
| `/api/ai/content/stream` | POST | Stream | `clients/ai` |
| `/api/ai/content/variants/[id]` | PATCH | JSON client | `clients/ai` |
| `/api/ai/history` | GET, DELETE | JSON client | `clients/ai` |
| `/api/ai/usage` | GET | JSON client | `clients/ai` |
| `/api/companies/[id]/jobs` | DELETE | JSON client | `clients/companies` |
| `/api/companies/[id]/overview` | GET | JSON client | `clients/companies` |
| `/api/companies/[id]` | PUT, PATCH, DELETE; GET retained without a current UI caller | JSON client / server-only | `clients/companies` |
| `/api/companies/bulk/jobs` | DELETE | JSON client | `clients/companies` |
| `/api/companies/bulk` | DELETE, PATCH | JSON client | `clients/companies` |
| `/api/companies/import` | POST | JSON client | `clients/companies` |
| `/api/companies/match` | POST | JSON client | `clients/companies` |
| `/api/companies/refresh-jobs` | POST | JSON client | `clients/companies` |
| `/api/companies` | GET | JSON client | `clients/companies` |
| `/api/companies/sync` | PUT | JSON client | `clients/companies` |
| `/api/health/live` | GET | Probe | process monitor only |
| `/api/health/ready` | GET | JSON client / probe | `clients/health`, System Info |
| `/api/health/runtime` | GET | JSON client / probe | `clients/health`, System Info |
| `/api/jobs/[id]` | GET, PATCH; DELETE retained without a current UI caller | JSON client / server-only | `clients/jobs` |
| `/api/jobs/match-data` | DELETE | JSON client | `clients/jobs` |
| `/api/jobs/match-unmatched` | GET, POST | JSON client | `clients/runtime` |
| `/api/jobs` | GET | JSON client | `clients/jobs` |
| `/api/maintenance/jobs/clear` | POST | JSON client | `clients/jobs` |
| `/api/maintenance/match-history/clear` | POST | JSON client | `clients/history` |
| `/api/maintenance/people/clear` | POST | JSON client | `clients/people` |
| `/api/maintenance/scrape-history/clear` | POST | JSON client | `clients/history` |
| `/api/match-history/[id]/cancel` | POST | JSON client | `clients/history` |
| `/api/match-history/[id]` | GET, DELETE | JSON client | `clients/history` |
| `/api/match-history` | GET | JSON client | `clients/history` |
| `/api/match` | POST | JSON client | `clients/runtime` |
| `/api/match/sessions/[id]` | GET; DELETE retained without a current UI caller | JSON client / server-only | `clients/runtime` |
| `/api/people/[id]/merge` | POST | JSON client / server-only | `clients/people` |
| `/api/people/[id]/purge` | DELETE | JSON client / server-only | `clients/people` |
| `/api/people/[id]/restore` | POST | JSON client / server-only | `clients/people` |
| `/api/people/[id]/sources/[sourceRecordId]/split` | POST | JSON client / server-only | `clients/people` |
| `/api/people/[id]` | GET, PATCH, DELETE | JSON client / server-only | `clients/people` |
| `/api/people/company-aliases/[id]` | PATCH, DELETE | JSON client / server-only | `clients/people` |
| `/api/people/company-aliases` | GET | JSON client / server-only | `clients/people` |
| `/api/people/duplicates` | GET | JSON client / server-only | `clients/people` |
| `/api/people/ignored-unmatched-companies` | GET | JSON client | `clients/people` |
| `/api/people/import-sessions` | GET | JSON client | `clients/people` |
| `/api/people/import-sessions/[id]` | GET | JSON client / server-only | `clients/people` |
| `/api/people/import/preview` | POST | JSON client (multipart) | `clients/people` |
| `/api/people/import` | POST | JSON client (multipart) | `clients/people` |
| `/api/people` | GET, POST | JSON client | `clients/people` |
| `/api/people/unmatched-companies` | GET, PATCH | JSON client | `clients/people` |
| `/api/people/unmatched-company-people` | GET | JSON client | `clients/people` |
| `/api/profile/education/[id]` | PATCH, DELETE | JSON client | `clients/profile` |
| `/api/profile/education` | GET, POST | JSON client | `clients/profile` |
| `/api/profile/experience/[id]` | PATCH, DELETE | JSON client | `clients/profile` |
| `/api/profile/experience` | GET, POST | JSON client | `clients/profile` |
| `/api/profile/parse-resume` | POST | JSON client (multipart) | `clients/profile` |
| `/api/profile/resume-review` | POST | JSON client | `clients/profile` |
| `/api/profile/resumes/[id]/download` | GET | Download | `clients/profile` |
| `/api/profile/resumes/[id]` | DELETE | JSON client | `clients/profile` |
| `/api/profile` | GET, POST | JSON client | `clients/profile` |
| `/api/profile/skills/[id]` | DELETE; PATCH retained without a current UI caller | JSON client / server-only | `clients/profile` |
| `/api/profile/skills` | GET, POST | JSON client | `clients/profile` |
| `/api/providers/[id]/models` | GET | JSON client | `clients/providers` |
| `/api/providers/[id]` | PATCH, DELETE; GET retained without a current UI caller | JSON client / server-only | `clients/providers` |
| `/api/providers/[id]/validate` | POST | Server-only | provider diagnostics |
| `/api/providers/local-cli/status` | GET | Server-only | provider diagnostics |
| `/api/providers` | GET, POST | JSON client | `clients/providers` |
| `/api/scheduler/recover` | POST | JSON client / startup runtime | `clients/runtime` |
| `/api/scheduler/status` | GET | JSON client | `clients/runtime` |
| `/api/scrape-history/[id]/cancel` | POST | JSON client | `clients/history` |
| `/api/scrape-history/[id]` | GET, DELETE | JSON client | `clients/history` |
| `/api/scrape-history` | GET | JSON client | `clients/history` |
| `/api/settings` | GET, PATCH | JSON client | `clients/settings` |
| `/api/stats` | GET | JSON client | `clients/stats` |
