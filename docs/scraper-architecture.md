# Scraper architecture

Switchy runs its scraping pipeline entirely on the user's device. SQLite is the durable coordinator; there is no cloud queue, remote worker service, Redis dependency, or external control plane.

## Runtime flow

```mermaid
flowchart LR
  A[Manual refresh] --> Q[Durable SQLite queue]
  B[Local scheduler] --> Q
  C[Startup recovery] --> Q
  Q --> G[Concurrency and company gates]
  G --> R[Platform registry]
  R --> API[ATS JSON or GraphQL API]
  R --> HTTP[Static HTTP extraction]
  R --> Browser[Browser fallback]
  API --> P[Atomic job persistence]
  HTTP --> P
  Browser --> P
  P --> L[Scrape log]
  P --> M[Durable AI match work]
```

Manual and scheduled requests use the same in-process supervisor. Each company is represented by a durable queue item with an attempt count, retry time, cancellation flag, worker lease, and serialized result. A process restart recovers expired leases and continues unfinished work.

Synchronous batch callers coalesce identical in-flight company batches. Manual HTTP submissions retain separate durable sessions. Company locks and committed-result reuse prevent overlapping sessions from fetching the same company twice. Stored queue timestamps have one-second precision, so requests in the same second can reuse the earlier result.

## Module boundaries

`createLocalScrapeQueueService()` and `getLocalScrapeQueueService()` are the public composition boundary. The factory accepts a database, HTTP/browser clients, persistence ports, clock, matching callbacks, and runtime checks. The one-company pipeline imports no global AI configuration or dispatcher. Production defaults are wired only in the composition root. The queue service is a thin façade for enqueueing, waiting, recovery, and cancellation; batch work never bypasses the durable queue.

- `application/` owns the one-company pipeline, work handler, session projection, and retention policy.
- `lib/runtime/` owns shared leased work, heartbeats, bounded retry, single-flight dispatch, data maintenance gates, keyed locks, and device sleep protection. Scraping and matching supply their own rate-limit policies.
- `lib/scraper/runtime/` owns scraper resource limits and device-wake checks.
- `queue/`, `history.ts`, and `maintenance/` adapt scraper persistence ports to the existing SQLite schema. `lib/ai/work-items/` owns durable matching work.
- `platforms/` owns extraction only. Shared listing selection preserves platform object identity while applying early filters and existing-ID exclusion; detail hydration is bounded and cancellation-aware.
- `settings/` is the typed source for scraper concurrency, filters, and retention defaults.

The durable match handoff is created in the same transaction as committed scrape results. Post-scrape, manual, company, and unmatched matching all create `aiWorkItems` and use the same durable match-session lifecycle. The local worker reports claim, progress, retry, completion, cancellation, and recovery transitions through the shared leased-work runtime.

## Extraction strategy

The preferred order is:

1. Use a documented or stable ATS JSON/GraphQL endpoint when one is available.
2. Use direct HTTP extraction for server-rendered listing pages.
3. Use the browser transport only when JavaScript execution, cookies, or anti-CSRF behavior requires it.
4. Keep platform-specific selectors and request logic behind the scraper registry.

This hybrid approach remains the right fit for a local application. Replacing every scraper with a headless browser would increase memory usage and failure surface. Replacing platform adapters with a generic AI extraction step would make results slower, less deterministic, and harder to test. AI-assisted extraction can be added later as an explicit fallback, but should not become the primary path for ATS platforms with structured endpoints.

External payload validation is strict for the response envelope and job identity fields, but tolerant of optional, nullable, and polymorphic metadata. Workday accepts null optional listing metadata, reports the names of rejected fields without logging payload values, and keeps malformed or incomplete lists partial. Eightfold first-page failures retain the fetch stage, offset and HTTP status. When some jobs are malformed, adapters retain usable jobs, mark listing completeness as partial, and prevent missing-job archival.

Queue items use a static platform priority derived from production history. Eightfold is ranked first, Workday next, and fast HTTP adapters follow. The ordered queue interleaves one fast adapter after every two long-running items. This starts long jobs early, keeps an HTTP lane busy, and remains deterministic.

All adapters share the user-configured total concurrency budget. Actual browser lifetimes share a two-browser gate inside the browser client. HTTP-only Eightfold and Workday runs do not occupy browser permits. Workday retains its global company serialization and paced host requests. Separate sessions cannot scrape the same company simultaneously.

Queue admission enforces serialization before leasing work. While a Workday
company is running, other Workday companies stay queued without consuming
workers or execution permits. The claim transaction also excludes companies
already running in another session. URL detection covers legacy records without
a valid saved platform. The in-process Workday lock remains a safety guard for
direct scraper calls; the browser-limited classification also reserves general
HTTP execution capacity. Admission constraints live in
`services/execution-policy.ts`, independently of browser allocation.

Adapter results and pipeline exceptions use the same failure classifier in `lib/scraper/types/validation.ts`. It preserves HTTP status and retry hints, distinguishes cancellation from timeout, and keeps retry decisions consistent with terminal scrape logging.

## Workday query policies

`platforms/workday.ts` coordinates extraction and browser recovery. Its
`workday/` directory separates request configuration, payload parsing, country
facet discovery, and checkpointed pagination. Shared HTTP infrastructure owns
request pacing; the pipeline owns persistence and archival.

The first listing response supplies the board's current facet parameters and
opaque IDs. Country discovery walks nested groups and recognizes both parameter
names and country descriptors, including boards whose parameter is simply `a`.
It preserves the configured search text and other facets, intersecting an
existing restriction on the same parameter. It never replaces that restriction
with a broader country query.

When a board exposes only location IDs, automatic mode proposes the locations
whose labels identify the requested country. Before using this shortcut, it
fetches a complete, exact baseline and verifies that the proposed query retains
every country-matching listing. Validation persists for 24 hours in
`scrape_fetch_state`, keyed by the full source query and country. A change to any
location ID or label invalidates the proof. Counts may change without forcing a
new baseline. Subsequent runs still discover current facets, but can skip the
full baseline. Unknown mappings, rejected parameters, or failed coverage checks
retain the configured source query. Genuine throttling still defers the run.

`workday/config.ts` defines typed defaults and hostname/board overrides. The
composition factory and registry accept the same configuration, for example:

```ts
createLocalScrapeQueueService({
  workday: {
    countryFilter: { mode: "auto" },
    boardPolicies: [
      {
        hostname: "example.wd5.myworkdayjobs.com",
        board: "External",
        countryFilter: { mode: "country-only", parameter: "custom_country" },
      },
      {
        hostname: "legacy.wd5.myworkdayjobs.com",
        countryFilter: { mode: "disabled" },
      },
    ],
  },
});
```

Host overrides inherit shared defaults; board overrides inherit host policy.
Aliases and validation TTL are configurable. Overrides identify parameter
semantics, while the board supplies its current IDs. Adding a company does not
require a branch in the scraper or a hardcoded country ID.

Workday listing requests remain at 20 jobs because larger limits returned HTTP
400 on tested boards. Queries that reach the 2,000-result ceiling, repeat a
listing page, contain malformed identities, or resume mixed snapshots remain
partial and cannot authorize archival. Query partitioning beyond that ceiling
is not implemented. Filtering by country can avoid the global ceiling, but a
country query that still reaches it also remains partial.

The HTTP client coordinates request starts per host. Workday retains a
1.5-second minimum interval without adding a second delay after each response.
Real 429s increase the interval up to 12 seconds; five successful responses
reduce it gradually toward the minimum. Persistent host cooldowns and
`Retry-After` still apply. Browser challenges remain separate from rate limits.
Workday company serialization and default listing/detail concurrency stay at
one. Optional detail country, locations, and publication dates are retained
when available; malformed optional metadata cannot discard a valid description.

## Query optimization across ATS adapters

The composition factory accepts `queryPolicies` for TalentBrew, Lever, Eightfold,
Oracle, Uber, SmartRecruiters and Rippling. Each adapter builds its native
requests. `platforms/shared/query-optimizer.ts` owns policy resolution and
coverage validation; `services/listing-scope.ts` keeps narrowed snapshots from
archiving jobs outside their query. Workday retains its facet-specific policy
under the separate `workday` configuration.

```ts
createLocalScrapeQueueService({
  queryPolicies: {
    platforms: {
      talentbrew: { pageSize: 100 },
      lever: { pageSize: 1_000 },
    },
    boards: [{
      platform: "eightfold",
      hostname: "example.eightfold.ai",
      board: "example.com",
      policy: { countryFilter: false },
    }],
  },
});
```

Board policy inherits hostname policy, which inherits platform defaults. The
first optimization attempt requires a complete, exact baseline. A country query
must preserve every ID accepted by the existing country filter, including
globally eligible remote jobs. A larger unfiltered page size must preserve the
entire ID set. Validation persists for 24 hours in `scrape_fetch_state`, keyed by
platform, complete source URL, board, country and request semantics. Changed
native TalentBrew country facets create a new validation key. Unsupported or
incomplete paths retain the baseline; a cached query that later becomes partial
stays partial. Genuine throttling and browser challenges propagate without an
unfiltered retry. Both successful and unsuccessful proofs expire, allowing
future capability changes to be checked again.

The initial validation and daily revalidation can still require a full crawl.
Cached runs use the narrower requests. Automatic country optimization skips
small boards already returned in one page. `minimumCountryListings` can adjust
that threshold per platform or board. Filtering that returns the same ID set as
the full board stays on the original path. Every narrowed result carries its
own listing scope. Source-filtered Google and Atlassian snapshots also identify
their scope. Other new country paths require an unfiltered source URL; Eightfold
preserves its existing query, sort and location constraints.

- TalentBrew discovers native country facet IDs and submits their actual model
  fields. Country and global-remote facets travel together on every page. Larger
  pages use the server's returned pagination metadata, with exact unique counts
  and repeated-page checks. The preferred size is 100.
- Lever prefers 1,000 where full ID validation succeeds. It advances offsets by
  returned lengths and verifies the end with a one-item request. A silently
  clamped page cannot masquerade as the final page.
- Eightfold stays at ten results per page. It adds the preferred country only
  when the source has no location and preserves explicit remote/search settings.
  Narrowed queries cannot use a global sitemap to certify their scope.
- Oracle and Uber share the native country/location query and remote-workplace
  union. Requests stay at or below 200. Overlapping discovery pages are merged by
  ID before coverage validation, and observed server page lengths constrain the
  pagination stride on larger result sets.
- SmartRecruiters stays at or below 100 and unions its ISO country query with
  remote postings. Changing totals, overlapping pages and malformed records stay
  incomplete.
- Rippling retains one bulk request for its current small board. Its optional
  location-facet path includes global remote labels; larger boards can narrow
  automatically after validation. Raw unique index records are checked against
  `nbHits`, independently of merged job IDs, so an index pagination ceiling cannot
  authorize archival. Repeated pages and the local sweep limit stay partial.
- Phenom keeps its existing extraction path. Larger public widget pages remain
  disabled because live checks did not establish complete unique-ID coverage.

Descriptions supplied by full feeds do not reserve HTTP detail-maintenance
quota. ServiceNow and TurboHire pass supplied records directly through selection;
Atlassian follows its existing listing-description short circuit with the same
quota rule. New records, filtered records and actual HTTP detail requests keep
their existing priority and limits. Optional Greenhouse office locations, Ashby
structured address countries, Lever's `allLocations`, and Uber's secondary work
locations improve filtering without extra detail requests. A primary country
cannot exclude an advertised secondary or globally remote location.

## Reliability guarantees

- Session creation and queue insertion are one SQLite transaction.
- Queue claims use leases and atomic compare-and-update transitions.
- Retryable scraper errors use bounded exponential backoff and honor a platform retry delay.
- Job synchronization, company metadata, audit logging, and the matching handoff commit atomically.
- If the process stops after job persistence but before queue completion, the queue result is rebuilt from the committed scrape log instead of scraping again.
- Startup recovery handles expired work and schedules future retry or lease times.
- A large heartbeat clock gap pauses every active leased task, including tasks waiting at resource gates. Interrupted tasks are deferred for at least one minute without spending a network retry attempt, even on the final attempt. Cancellation still takes precedence over deferral.
- Browser-session bootstrap failures identify the sanitized launch, navigation, settle, or session-extraction stage without persisting cookies, tokens, headers, or response bodies.
- On macOS, dispatch checks system CPU, Graphics and Network capabilities before recovering leases or claiming work. CPU/network-only maintenance DarkWake defers dispatch for a minute; recovery remains backend-owned and needs no open browser tab. If the OS probe is unavailable, dispatch falls back to clock-gap recovery with a warning.
- Eightfold and Workday retry missing list offsets with one refreshed browser session before committing a partial result. Workday also retries failed details once and retains listing-only jobs when hydration remains unavailable.
- Uber and Oracle use shared native recruitingCE schemas, URL construction, pagination and completeness handling, with separate tenant configuration and field mapping. Oracle retains overlapping pages to limit pagination drift.
- ServiceNow reads the complete XML feed in one request. It does not perform HTML pagination or per-job detail downloads.
- Cancellation stops the parent session, cancels queued items immediately, and signals running items.
- Job or company deletion terminates related scrape and match work before data is removed.
- SQLite busy errors on queue transitions receive short bounded retries.

The queue provides at-least-once execution with idempotent completion. Platform fetches can be repeated after a crash, but committed job results are not repeated once their success or partial log exists.

## Discovery, updates and archival

`openExternalIds` represents discovered listings independently of detail success.
Adapters that hydrate details also return `listingJobs` so known jobs can receive
listing metadata without downloading their descriptions. The pipeline uses exact
URLs to preserve historical IDs when listing and detail identifiers differ.
Jobvite selects details before downloading them and retains listing identities
when individual detail requests fail.

Updates compare all supplied source fields. Missing fields do not erase saved
values, and a teaser cannot replace an existing description. Only exact ID or URL
matches can update saved content; fuzzy title matches cannot overwrite it.
Deduplication indexes IDs and URLs once per batch and limits fuzzy comparisons to
compatible location and identity candidates.

Jobs record source publication and update dates, all available source locations,
`lastSeenAt`, `detailsFetchedAt`, and description quality. Greenhouse publication
uses `first_published`, independently of `updated_at`. Ashby and Lever use
explicit workplace fields before inferring type from location text. Ashby
compensation and secondary locations are retained; unlisted Ashby posts are
excluded. Lever supports global and EU hosts and bounded explicit pagination.

Full existing descriptions become eligible after a deterministic 24-to-30-hour
window, spread by job identity. Description maintenance selects at most five
existing described jobs per company, oldest first, and shares a durable
25-record budget across the session. A company waits six hours after reserving a
maintenance batch, leaving subsequent runs' capacity available to other
companies. Capacity is also reserved for older unmet demand so companies later
in the queue are not starved across repeated runs; unseen demand expires after
24 hours. These are eligibility windows, not a promise that every description
is refreshed daily; large backlogs are processed gradually within the budget.

New jobs, missing descriptions, and teasers have priority and do not spend the
maintenance quota. Closed and filtered historical jobs cannot consume it.
Legacy descriptions with unknown freshness use the maintenance budget without
inventing a fetch timestamp. A successful refresh advances its timestamp even
when content is unchanged. Failed maintenance retains the saved description.
The budget and cooldown persist in `scrape_fetch_state`; quota increments are
atomic, and failure to reserve capacity skips optional maintenance rather than
failing discovery. Per-company and session limits, cooldown, and freshness
interval are configurable through pipeline construction; zero disables the
corresponding maintenance quota.

Each attempt emits a structured `scrape_timing` event. Successful queue results
also retain the metrics in their existing result JSON. Metrics distinguish
ready-queue waiting, execution admission, the Workday lock, host-slot waiting,
HTTP attempt time including response buffering, pacing, retry delays, actual
HTTP requests, server rate limits, local cooldown blocks, and selected priority
and maintenance details. Selected details are not an HTTP request count, since
retries and browser recovery can make additional requests. Existing aggregate
fetch timing remains compatible and includes adapter-level lock waiting. No
metrics controls or new diagnostics are added to the settings UI.

Archival requires a complete discovery snapshot and an exact advertised total
when available. Across every platform, a disappearance exceeding the larger of
five jobs or five percent of eligible saved jobs pauses archival. The same
missing set must appear in a second complete snapshot at least one minute later
and within 24 hours. Confirmation survives restarts in `scrape_fetch_state`;
incomplete snapshots reset it. A paused archival adds a visible warning.

Workday additionally records membership for each canonical source query. The
first complete snapshot establishes a baseline after job persistence succeeds.
Later runs can archive only jobs previously observed in that scope. Jobs outside
the query receive no synthetic last-seen update or reopen signal. Partial runs
cannot replace the baseline, and members awaiting disappearance confirmation
remain eligible for the next confirmation. An expired or unavailable baseline
disables scoped archival until another complete snapshot establishes it.

Source-closed jobs reopen when they are listed again. Age-archived jobs stay
hidden when still listed, preventing the age policy and source reconciliation
from repeatedly reopening and archiving them. Manual archives and application
statuses remain protected. Last-seen timestamps advance independently of
content updates.

The atomic AI handoff includes newly inserted full descriptions and eligible
existing jobs whose AI fingerprint changed, including description backfills.
Unchanged refreshes and teaser-only insertions do not create matching work.
Refresh timestamps alone do not increment `jobsUpdated`.

HTTP responses are limited to 64 MiB, checked both against Content-Length and
while consuming the decoded stream. Short retry backoffs release host slots.
Long rate limits retain Retry-After for durable queue deferral. Detail batch
exceptions preserve bounded structured issue information instead of only a
failure count.

## Local resource controls

The Settings page exposes:

- **Max Parallel Scrapes**: the shared API/browser concurrency limit, from 1 to 10.
- **History Retention**: terminal scrape sessions and logs are pruned after 7 to 3,650 days; the default is 60 days.

Retention never deletes jobs, companies, uploads, active/leased queue work, or an active matching handoff. Pruning runs on the first supervisor pass after startup and is then throttled to at most once per day for that process.

The separate **Power** section exposes **Keep awake while scraping or matching**, enabled by default. A process-wide activity manager shares one macOS assertion across scraper and matching workers, independently of whether scheduling is enabled. It releases the assertion one second after the last worker finishes, fails, or is cancelled, avoiding churn between adjacent tasks. Idle scheduling and future retry waits do not hold an assertion. Setting changes apply to active work immediately. The original stored setting key is retained for compatibility.

The assertion uses `/usr/bin/caffeinate -i -w <server-pid>` for the active lease, without timed renewal. Acquisition checks `pmset` for the child's registered idle-sleep assertion. An unexpected helper exit or failed acquisition triggers a retry with bounded exponential backoff from one to thirty seconds. Release cancels retries and stops the helper; server exit also bounds its lifetime. Assertion failures are warnings and do not fail job processing. The display may sleep; lid-close, explicit sleep and low-battery sleep can still suspend the Mac. Other operating systems use a no-op inhibitor.

## Observability and recovery

The scrape-session detail page merges queue state and company logs into one live company-progress view. Each row shows status, attempts, retry and lease timing, scrape counts, matching progress, and all attempt warnings or errors. The underlying API is `GET /api/scrape-history/:id`.

For local troubleshooting:

1. Open **History → Scrape** and inspect the company-progress view.
2. A `queued` item with attempts remaining will run at its `availableAt` time.
3. A `running` item with an expired lease is recovered on startup or the next supervisor pass.
4. Destructive maintenance signals related in-process work first, then takes an exclusive data-operation fence before deleting records.
5. Run `pnpm db:studio` when direct local database inspection is needed.
6. Run `pnpm verify` before releasing scraper changes.

## Migration compatibility

Known retired Postman and Swiggy sources are migrated in place to Workday and SmartRecruiters. The obsolete JioHotstar Lever source is disabled when a JioStar Workday board already exists, or migrated in place otherwise. These idempotent data repairs preserve disabled states, company IDs, jobs and application history. New installs use the updated preset catalog.

Generated migrations are append-only once they may have been applied to a local database. Migrations 0012 through 0014 intentionally remain as a correction chain: the final schema is correct for fresh installs, while retaining the intermediate hashes keeps existing local databases compatible. Do not squash or rewrite those files; generate any future schema change with Drizzle.

## Contract checks and source changes

Run `pnpm scraper:check-contracts` for bounded public-listing checks using the real
adapters, or pass platform names to select checks. Each adapter receives up to
four HTTP operations and a 20-second deadline. Transport redirects remain
bounded separately. The checks exclude detail downloads by title filter, use no
browser or application database, and report compatible samples separately from
contract failures and inconclusive network/challenge responses. The weekly
`Scraper contracts` workflow runs the same checks and can be started manually.
These probes do not establish full pagination coverage or tenant-wide parity.
Fixture tests and the dedicated live validation commands complement them.

The November 26 source review confirmed current public contracts for Greenhouse,
Lever, Ashby and SmartRecruiters. Workday CXS, Eightfold PCSX, TurboHire guest
requests, Oracle recruitingCE and company careers endpoints depend on observed
native interfaces and need continued monitoring. Phenom null search bootstrap
responses receive one bounded reload and cannot become complete empty boards.

Visa now uses the shared Workday adapter at
`https://visa.wd5.myworkdayjobs.com/Visa` (`visa/Visa`). The November 27 browser
transport check succeeded after direct requests received a Cloudflare challenge.
The complete global crawl returned all 937 advertised records. Complete and
repeat India listing crawls both returned all 96 advertised records.
The older Visa feed still responded with 52 records, which did not establish
coverage of the current board. The dedicated legacy adapter has been removed.

Startup source migration deletes legacy `visa` company rows and their linked job
and matching data, then adds Visa as a new Workday company. This intentional reset
avoids carrying retired source identities into the new board. An existing Visa
Workday company is retained unchanged. The transaction runs with foreign keys
enabled, removes restrictive queued-work references before deletion, and is
idempotent. No schema change or network request is required during startup.

## Adding a platform

1. Prefer the platform's structured endpoint and implement its adapter under `lib/scraper/platforms/`.
2. Return the typed scraper result contract, including listing completeness, structured errors, and partial-result issues.
3. Declare transport and concurrency capabilities accurately.
4. Register the adapter in the scraper registry.
5. Add fixture-based parser tests, error classification tests, and pipeline characterization coverage under `tests/`.
6. Verify cancellation is passed through every network or browser operation.

Do not put persistence or durable queue retries inside a platform adapter. Transport-specific recovery of missing pages or details may happen inside the adapter before the result is committed; once a partial result is committed, replay protection remains authoritative.

## Test layout

- `tests/unit/` contains isolated Node tests for policies, adapters, runtimes, and API mapping.
- `tests/integration/` contains real temporary-SQLite and migration coverage.
- `tests/ui/` contains jsdom component and hook tests.
- `tests/helpers/` contains shared test-only database and client stubs; `tests/fixtures/` contains platform payload builders.

Production code must never import `@test/*`. Use `pnpm test:unit`, `pnpm test:integration`, and `pnpm test:ui` for focused work, then `pnpm verify` before committing scraper changes.
