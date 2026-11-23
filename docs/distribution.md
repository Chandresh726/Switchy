# Switchy stable distribution

Switchy is distributed as a small npm CLI plus platform-specific standalone
application runtimes hosted on a GitHub release. The npm package does not
contain user data or the complete Next.js application.

## User flow

```bash
npx @chandresh726/switchy@latest start
npx @chandresh726/switchy@latest status
npx @chandresh726/switchy@latest stop
npx @chandresh726/switchy@latest update
```

`start` reuses the installed runtime and saved port. First installation and any
explicit version change use the update transaction described below, including
checksum verification, browser preparation, migration and rollback. Ordinary
starts do not rerun migrations or browser installation. Downgrades are rejected.
The server binds to `127.0.0.1`, with port `6767` as the initial default. Use
`start --port <port>` to change it.

Useful commands:

```bash
switchy restart
switchy status --json
switchy doctor
switchy update --check
switchy update --download
switchy update --apply
```

`doctor` prints local state and log locations without modifying the installation.
`update --download` stages a release while the app keeps running; `--apply`
installs that exact staged version without checking GitHub again. A plain
`update` checks and installs the latest stable version. Unknown options and
conflicting update actions are rejected.

`start --foreground` keeps output in the terminal and releases the control lock
after readiness. `stop` remains usable from another terminal. Foreground runs
are not restarted by the background manager.

Everything remains under one local root:

```text
~/.switchy/
  data/
    production/
    development/
  app/
    versions/
    current.json
  runtime/
  logs/
  cache/
    downloads/
    playwright/
  update-snapshots/
```

The `SWITCHY_HOME` environment variable can override this root with an absolute
path. It is primarily intended for automated tests and isolated installations.

## Stable release pipeline

The `release.yml` workflow runs only for stable `vMAJOR.MINOR.PATCH` tags. It:

1. verifies that the tag matches the CLI package version and points to a commit
   that already passed the complete `main` CI workflow;
2. reuses that successful CI result instead of rerunning the same verification;
3. builds and smoke-tests native runtimes on Linux x64/arm64, macOS
   arm64 (Apple Silicon), and Windows x64;
4. builds and audits the npm tarball once, then publishes that exact artifact;
5. creates one checksum manifest and immutable GitHub release;
6. publishes `@chandresh726/switchy` through npm trusted publishing when the
   repository variable `NPM_TRUSTED_PUBLISHING_READY` is `true`;
7. downloads published runtime assets to verify their size and SHA-256, then
   verifies the npm tarball against the packaged build and runs the exact
   published CLI version. Registry propagation is retried for a bounded period.
   If the installer cannot yet resolve the exact new Switchy version, verification
   retries every 15 seconds, up to six attempts within a three-minute budget.
   Checksum mismatches, other installation errors, and incorrect CLI versions fail
   immediately.
   Verification runs in separate jobs so retries do not republish assets.

Release permissions and GitHub's existing latest-release behavior are unchanged.

`packages/cli/package.json` is the single source of truth for the release
version. The application, runtime metadata, native helper, GitHub release, and
npm package all derive their version from that manifest. Pre-release tags are
rejected.

## One-time platform setup

Before the first public release:

1. In the GitHub repository, create a `production` environment. Add required
   reviewers if release approval is desired.
2. Keep `NPM_TRUSTED_PUBLISHING_READY` unset for the first release because npm
   trusted publishing can only be configured after the package exists.
3. Push the stabilized commit and its matching stable version tag. The workflow
   publishes the four runtimes, checksum manifest, and GitHub release.
4. From an authenticated owner account, run
   `npm publish ./packages/cli --access public` at that exact tag.
5. Configure the GitHub Actions trusted publisher:

   ```bash
   npm trust github @chandresh726/switchy \
     --file release.yml \
     --repository Chandresh726/Switchy \
     --environment production \
     --allow-publish \
     --yes
   ```

   The equivalent npm package-settings fields are owner `Chandresh726`,
   repository `Switchy`, workflow `release.yml`, environment `production`, and
   allowed action `npm publish`.
6. In GitHub Actions variables, set `NPM_TRUSTED_PUBLISHING_READY` to `true`.

No npm token is stored in GitHub. Starting with the next stable tag, the
workflow publishes both GitHub assets and npm automatically through OIDC.

## Release checklist

For each later stable release:

1. bump the single release version with `pnpm release:version patch` (or pass
   `minor`, `major`, or an exact stable version);
2. update release notes and run `pnpm verify:all`;
3. test a locally packaged runtime with `node scripts/smoke-runtime.mjs`;
   macOS notification helpers are always ad-hoc signed and require no Apple
   developer credentials;
4. merge the release commit;
5. create and push the exact matching stable tag;
6. approve the GitHub `production` environment if protection is enabled;
7. verify the GitHub release assets and npm version after the workflow finishes.

Do not overwrite an existing tag, GitHub release, runtime asset, or npm version.
Every release is append-only; corrections use a new patch version.

## Startup and automatic updates

Installed production runtimes expose **Settings → Startup, power & updates**. Startup
at sign-in and automatic updates are independent and default to off until the
user chooses them. Opening the browser at sign-in is a separate preference.
Startup registration is currently supported on macOS; automatic updates work
on all supported runtime targets.

Existing installations without lifecycle support need one stopped upgrade with
the latest CLI: run `pnpm dlx @chandresh726/switchy@latest stop`, then
`pnpm dlx @chandresh726/switchy@latest update`. After that, choose startup and
update preferences in Settings. The stopped upgrade avoids interrupting work
whose activity cannot be checked by an older runtime.

The equivalent startup commands are:

```bash
pnpm dlx @chandresh726/switchy@latest startup enable
pnpm dlx @chandresh726/switchy@latest startup disable
pnpm dlx @chandresh726/switchy@latest startup status
```

After starting a runtime that includes lifecycle support, Switchy installs a
persistent Node executable and a small supervisor under `~/.switchy/app/host/`.
It does not depend on a package-manager cache, shell profile, or network access
to start the installed application. A dependency-free bootstrap starts one
persistent manager from the selected runtime. The manager watches for requests
and preference changes, with a 30-second fallback timer for missed events and
process checks. It reloads after a committed runtime change. It does not launch
a new worker on every timer tick, and exits when stopped or its installation is
removed.

The host saves the executable search path without copying shell credentials.
This preserves local CLI discovery after login. Versioned Node executables are
refreshed on explicit starts with a newer Node 24, and the manager reloads onto that
version. The startup item is refreshed on explicit starts and settings changes. Application
and lifecycle logs rotate at 10 MiB and retain a bounded previous tail. `logs`
reads a bounded suffix rather than loading the whole log.

On macOS, enabling startup writes the per-user
`~/Library/LaunchAgents/com.switchy.lifecycle.plist` and enables the item for the
next login. This is separate from the scheduler's existing host agents. Disabling
startup leaves the current session running. `switchy stop` suppresses background
restarts until an explicit start or the next opted-in login. No system daemon
or administrator access is required. macOS background-item restrictions still
apply. A sleeping or powered-off laptop does not run Switchy.

Automatic updates check GitHub's stable release every six hours while Switchy
is running. Settings requests usually wake the manager immediately; the fallback
check handles them within about 30 seconds. Minor and patch releases can install automatically; major
versions require an explicit download and restart from **System Info**. An open
Switchy tab postpones automatic installation, including background tabs, to
protect unsaved edits. The download icon beside the version stages an update
without stopping Switchy. Once downloaded, it becomes a restart icon. Restarting
permits installation with tabs open; save edits first. Queued and running work
must finish before installation proceeds.

Update preferences and recovery records live outside the database in
`~/.switchy/runtime/`. An update downloads and checksum-verifies the runtime and
prepares Chromium before closing admission. It then rechecks activity, stops
the server, snapshots production data, and runs the packaged Drizzle migrator.
While the candidate is being checked, API admission and new job claims remain
closed. The candidate initializes and validates its scheduler and queue recovery
before readiness can succeed. External scheduler recovery and host registration
wait until commit. The updater commits only after readiness and process identity
checks pass. Managed processes register before opening SQLite and must match
the launcher's published PID and instance ID. Candidate runtimes must declare lifecycle protocol 2; older releases
without these guarantees are rejected. It then resumes normal operation. It retains
the previous runtime and the three most recent update snapshots. The previous
version is recorded explicitly and survives ordinary restarts.

Downloads hold the update lock, leaving stop available. Activation takes the
start lock after preparation; the lock order is update, start, then preferences.
An explicit stop during preparation prevents later activation. Directory locks
are published with complete, uniquely named ownership records. Stale cleanup
only removes the observed owner and an empty directory, never a new owner's
lock. Update requests have separate IDs and are acknowledged individually.
Journal writes and snapshot files are synced before migration; containing
directories are synced where the operating system supports it.

If migration or candidate startup fails, Switchy restores the previous data
snapshot and runtime before allowing new writes. An interrupted transaction is
recovered on the next start or manager tick. Recovery waits on the migration
lock, and migration children register before opening SQLite, so an orphaned
migrator cannot race a restore. Failed candidate versions are not
retried automatically. If recovery itself fails, admission stays closed and the
snapshot and transaction record remain available for diagnosis. Do not remove
these records to force startup without first recovering the data.

For isolated test environments, `SWITCHY_DISABLE_LIFECYCLE=1` prevents the CLI
from launching the supervisor. Startup and update opt-ins remain unchanged.

Source runs, including `pnpm dev` and `pnpm start` from a checkout, show these
controls but disable startup and update actions. Development runs send no
lifecycle heartbeats, and unsupported source production runs stop after the
capability probe. They do not create browser leases that defer installed updates. Those actions manage the
versioned production runtimes installed by the CLI; they do not update a source
checkout or restart the development server. Keep-awake settings can still be
used in development. End-to-end startup and update testing requires a packaged
production build containing the changes being tested.
