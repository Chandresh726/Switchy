# Switchy CLI

Run the local-first Switchy application without cloning or building the source repository.

```bash
npx @chandresh726/switchy@latest start
npx @chandresh726/switchy@latest status
npx @chandresh726/switchy@latest stop
npx @chandresh726/switchy@latest update
npx @chandresh726/switchy@latest logs
```

Switchy binds to `127.0.0.1` on port `6767` by default. Use
`start --port <port>` to override it. Application versions, runtime metadata,
logs, caches, the SQLite database, uploads, and the encryption secret remain
under `~/.switchy` on the local device.

Node.js 24 is required. The first start downloads the runtime for the current
platform and Playwright Chromium. Supported targets are macOS Apple Silicon,
Linux x64 and arm64, and Windows x64.

Native job-match notifications are macOS-only. The macOS runtime ships a
headless helper that Switchy launches when notification permission is
requested; users do not install or open a separate application. On Linux and
Windows the settings page reports notifications as unavailable.

The installed app supports optional startup on macOS and automatic updates.
Enable them in Settings. `switchy stop` pauses background restarts until the
next explicit start or an enabled startup at login.

Use `restart`, `status --json`, or the read-only `doctor` command for diagnostics.
`update --check` checks availability, `update --download` stages a release, and
`update --apply` installs the staged version. Ordinary starts reuse the installed
version. Version changes preserve a recovery snapshot and the previous runtime;
downgrades are rejected.

## License

MIT
