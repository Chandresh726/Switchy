# AI provider connections

Provider configuration is local and survives browser refreshes and application
restarts. API credentials and custom headers are encrypted in SQLite. CLI
credentials remain under the control of the installed CLI.

Settings separates saved configuration from availability. `Configured` means
Switchy has saved the setup. `Verified` means the most recent availability check
succeeded. API checks verify model discovery rather than running a billable
inference request. Individual model access can still fail at execution time.
Saved observations include their check time; an old observation is shown as a
saved status while it is rechecked. A failed check does not erase configuration.

Use **Check connection** after signing into a CLI externally or changing an API
credential. **Refresh models** explicitly rediscovers models. Both actions remain
available when the previous check failed. Failed refreshes retain saved models
and report that the refresh failed.

Executable overrides can be set before adding a CLI. Only the changed CLI is
reset after saving a new path. The supervised CLI process can stop after five
idle minutes and restart for subsequent work without requiring setup again.

Custom APIs default to automatic discovery through `/models`, with optional
manual additions. Choose **Use manual model IDs only** for an endpoint without a
model-list API. At least one ID is required in that mode. Saving manual IDs does
not verify that inference or authentication works.

Removing a provider repairs primary feature assignments using an available
replacement model, or clears the assignments if none is available. Matching
fallbacks referencing the removed provider are disabled. The removal dialog and
completion notification explain these effects.

## Code ownership

- `lib/ai/providers/metadata.ts` and `types.ts` are browser-safe definitions.
- `lib/ai/providers/connections/` owns persisted availability observations.
- `lib/ai/providers/catalog/` separates discovery from cache orchestration.
  API catalogs live here; CLI catalogs delegate to the CLI service rather than
  creating a second copy of the catalog.
- `lib/ai/providers/adapters/` resolves API and CLI backends through a common
  contract. The SDK provider registry only constructs SDK models.
- `lib/ai/local-cli/` owns executable resolution, CLI catalogs, and supervised
  protocol processes. A concurrent status or model request shares discovery
  work. Execution can recover an expired or missing catalog independently of UI.
- `lib/ai/runtime/backend.ts` defines the transport-independent generation
  contract. The capability runtime owns retries, deadlines, cancellation, usage,
  and run history.
- `components/settings/use-settings-providers.ts` coordinates settings queries.
  Saved catalogs load before background revalidation; saved selections remain
  visible while checks run. Custom forms and executable autosave are separate
  components.

Read-only provider listing never starts a CLI process or reconciles database
records. Legacy provider reconciliation runs during application startup.
Connection snapshots never bypass execution-time credential or model validation.
