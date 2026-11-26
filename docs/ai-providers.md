# AI provider connections

Provider configuration is local and survives browser refreshes and application
restarts. API credentials and custom headers are encrypted in SQLite. CLI
credentials remain under the control of the installed CLI.

Settings uses the original provider rows, connection badges, and refresh, edit,
and delete icons. Saved CLI status stays visible while background checks run.
The loading placeholder appears only when no CLI observation is available.
There is no separate connection-check button or last-checked timestamp.
API-key badges describe the saved setup; model discovery and execution report
availability errors separately. Individual model access can still fail at
execution time. A failed check does not erase configuration.

Use the existing **Refresh models** icon after signing into a CLI externally or
changing credentials. For a CLI, it rechecks availability and refreshes the
shared model catalog, then reads that catalog without discovering models twice.
The icon remains available when the previous check failed. Failed refreshes
retain saved models and update the availability state.

Executable overrides are edited through the existing provider's edit icon and
save automatically. Only the changed CLI is reset after saving a new path. The
supervised CLI process can stop after five idle minutes and restart for
subsequent work without requiring setup again.

Custom APIs default to automatic discovery through `/models`, with optional
manual additions. The original form has no model-discovery selector. Existing
manual-only configurations retain that mode when edited, including their model
IDs and masked headers. At least one ID is required for those configurations.
Saving manual IDs does not verify that inference or authentication works.

Removing a provider repairs primary feature assignments using an available
replacement model, or clears the assignments if none is available. Matching
fallbacks referencing the removed provider are disabled.

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
