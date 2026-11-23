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

`start` resolves the requested application version, downloads the matching
runtime when it is not already installed, verifies its SHA-256 checksum, runs
database migrations, installs Chromium into the local cache, and starts a
detached loopback-only server on port `6767` by default. Users can override the
port with `start --port <port>`. The CLI records and verifies the process
identity before stopping it.

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
   repository variable `NPM_TRUSTED_PUBLISHING_READY` is `true`.

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
to start the installed application. Each supervisor tick loads its manager
from the currently installed runtime, so release updates also update manager
code. Diagnostics are appended to `~/.switchy/logs/lifecycle.log`.

On macOS, enabling startup writes the per-user
`~/Library/LaunchAgents/com.switchy.lifecycle.plist` and enables the item for the
next login. This is separate from the scheduler's existing host agents. Disabling
startup leaves the current session running. `switchy stop` suppresses background
restarts until an explicit start or the next opted-in login. No system daemon
or administrator access is required. macOS background-item restrictions still
apply. A sleeping or powered-off laptop does not run Switchy.

Automatic updates check GitHub's stable release every six hours while Switchy
is running. Check, download, and restart requests from Settings are handled within
about 30 seconds. Minor and patch releases can install automatically; major
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
While the candidate is being checked, API requests are held and background
initialization waits. The updater commits the new version only after readiness
and process identity checks pass. It then resumes normal operation. It retains
the previous runtime and the three most recent update snapshots.

If migration or candidate startup fails, Switchy restores the previous data
snapshot and runtime before allowing new writes. An interrupted transaction is
recovered on the next start or manager tick. Failed candidate versions are not
retried automatically. If recovery itself fails, admission stays closed and the
snapshot and transaction record remain available for diagnosis. Do not remove
these records to force startup without first recovering the data.

For isolated test environments, `SWITCHY_DISABLE_LIFECYCLE=1` prevents the CLI
from launching the supervisor. It does not alter saved user preferences.

Source runs, including `pnpm dev` and `pnpm start` from a checkout, show these
controls but disable startup and update actions. Those actions manage the
versioned production runtimes installed by the CLI; they do not update a source
checkout or restart the development server. Keep-awake settings can still be
used in development. End-to-end startup and update testing requires a packaged
production build containing the changes being tested.
