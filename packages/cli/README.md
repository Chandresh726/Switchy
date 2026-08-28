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
platform and Playwright Chromium. Supported targets are macOS Intel and Apple
Silicon, Linux x64 and arm64, and Windows x64.

Native job-match notifications are macOS-only. The macOS runtime ships a
headless helper that Switchy launches when notification permission is
requested; users do not install or open a separate application. On Linux and
Windows the settings page reports notifications as unavailable.

## License

MIT
