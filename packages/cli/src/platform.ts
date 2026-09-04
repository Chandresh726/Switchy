const SUPPORTED_TARGETS = [
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
] as const;

const supportedTargets = new Set<string>(SUPPORTED_TARGETS);

export function isSupportedTarget(target: string): boolean {
  return supportedTargets.has(target);
}

export function currentTarget(
  platform = process.platform,
  architecture = process.arch
): string {
  const target = `${platform}-${architecture}`;
  if (!isSupportedTarget(target)) {
    throw new Error(`Switchy does not provide a runtime for ${target}`);
  }
  return target;
}
