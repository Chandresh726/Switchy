# Switchy CLI

Run the local-first Switchy application without cloning or building the source repository.

```bash
npx @chandresh726/switchy@latest start
npx @chandresh726/switchy@latest status
npx @chandresh726/switchy@latest stop
npx @chandresh726/switchy@latest update
npx @chandresh726/switchy@latest logs
```

Switchy binds to `127.0.0.1`. Application versions, runtime metadata, logs,
caches, the SQLite database, uploads, and the encryption secret remain under
`~/.switchy` on the local device.

Node.js 24 is required. The first start downloads the runtime for the current
platform and Playwright Chromium. Supported targets are macOS Intel and Apple
Silicon, Linux x64 and arm64, and Windows x64.

## License

MIT
