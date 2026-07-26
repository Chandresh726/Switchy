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
detached loopback-only server. The CLI records and verifies the process identity
before stopping it.

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

1. verifies that the tag, application version, and CLI version match;
2. runs the complete root and landing verification;
3. builds and smoke-tests native runtimes on Linux x64/arm64, macOS
   x64/arm64, and Windows x64;
4. creates one checksum manifest and immutable GitHub release;
5. publishes `@chandresh726/switchy` through npm trusted publishing when the
   repository variable `NPM_TRUSTED_PUBLISHING_READY` is `true`.

The Git tag, root `package.json`, CLI `package.json`, runtime metadata, GitHub
release, and npm package must all use the same version. Pre-release tags are
rejected.

## One-time platform setup

Before the first public release:

1. In the GitHub repository, create a `production` environment. Add required
   reviewers if release approval is desired.
2. Keep `NPM_TRUSTED_PUBLISHING_READY` unset for the first release because npm
   trusted publishing can only be configured after the package exists.
3. Push the stabilized commit and the matching `v1.0.2` tag. The workflow
   publishes the five runtimes, checksum manifest, and GitHub release.
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

1. update both package versions;
2. update release notes and run `pnpm verify:all`;
3. test a locally packaged runtime with `node scripts/smoke-runtime.mjs`;
4. merge the release commit;
5. create and push the exact matching stable tag;
6. approve the GitHub `production` environment if protection is enabled;
7. verify the GitHub release assets and npm version after the workflow finishes.

Do not overwrite an existing tag, GitHub release, runtime asset, or npm version.
Every release is append-only; corrections use a new patch version.
