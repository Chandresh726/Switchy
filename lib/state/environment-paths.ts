import os from "node:os";
import path from "node:path";

export type StateEnvironment = "development" | "production";

export interface StatePaths {
  environment: StateEnvironment;
  rootStateDirectory: string;
  coordinationDirectory: string;
  stateDirectory: string;
  uploadsDirectory: string;
  databasePath: string;
  encryptionSecretPath: string;
}

export function getStatePaths(
  environment: StateEnvironment,
  homeDirectory = os.homedir()
): StatePaths {
  const baseDirectory = path.join(homeDirectory, ".switchy");
  const stateDirectory =
    environment === "development" ? path.join(baseDirectory, "dev") : baseDirectory;

  return statePathsFromDirectory(environment, stateDirectory);
}

export function statePathsFromDirectory(
  environment: StateEnvironment,
  stateDirectory: string
): StatePaths {
  const rootStateDirectory =
    environment === "development" ? path.dirname(stateDirectory) : stateDirectory;
  return {
    environment,
    rootStateDirectory,
    coordinationDirectory: `${rootStateDirectory}.coordination`,
    stateDirectory,
    uploadsDirectory: path.join(stateDirectory, "uploads"),
    databasePath: path.join(stateDirectory, "switchy.db"),
    encryptionSecretPath: path.join(stateDirectory, "encryption.secret"),
  };
}
