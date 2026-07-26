export interface ReleaseArtifact {
  file: string;
  sha256: string;
  size: number;
}

export interface ReleaseManifest {
  schemaVersion: 1;
  version: string;
  publishedAt: string;
  nodeVersion: string;
  artifacts: Record<string, ReleaseArtifact>;
}

export interface ProcessRecord {
  schemaVersion: 1;
  pid: number;
  instanceId: string;
  version: string;
  hostname: string;
  port: number;
  startedAt: string;
}

export interface CurrentVersionRecord {
  schemaVersion: 1;
  version: string;
  updatedAt: string;
}

export interface SwitchyPaths {
  root: string;
  data: string;
  productionData: string;
  app: string;
  versions: string;
  currentVersion: string;
  runtime: string;
  processRecord: string;
  installLock: string;
  startLock: string;
  logs: string;
  logFile: string;
  cache: string;
  downloads: string;
  playwright: string;
  updateSnapshots: string;
}
