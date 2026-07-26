import packageJson from "../package.json" with { type: "json" };

export const CLI_VERSION = packageJson.version;
export const DEFAULT_PORT = 6767;
export const DEFAULT_HOSTNAME = "127.0.0.1";
export const GITHUB_REPOSITORY = "Chandresh726/Switchy";
export const RELEASE_MANIFEST_FILE = "switchy-manifest.json";
export const STARTUP_TIMEOUT_MS = 60_000;
export const SHUTDOWN_TIMEOUT_MS = 15_000;

export function resolveApplicationVersion(requestedVersion?: string): string {
  return requestedVersion ?? CLI_VERSION;
}

export function assertSupportedNodeVersion(
  nodeVersion = process.versions.node
): void {
  if (!/^24\.\d+\.\d+$/u.test(nodeVersion)) {
    throw new Error(
      `Switchy requires Node.js 24; current version is ${nodeVersion}`
    );
  }
}
