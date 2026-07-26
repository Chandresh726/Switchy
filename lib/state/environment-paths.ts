import path from "node:path";

import {
  getEnvironmentDataDirectory,
  getRuntimeDirectory,
  getSwitchyRootDirectory,
} from "./layout";

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
  environment: StateEnvironment
): StatePaths {
  const rootStateDirectory = getSwitchyRootDirectory();
  const stateDirectory = getEnvironmentDataDirectory(
    environment,
    rootStateDirectory
  );
  return {
    ...statePathsFromDirectory(environment, stateDirectory),
    rootStateDirectory,
    coordinationDirectory: path.join(
      getRuntimeDirectory(rootStateDirectory),
      "coordination"
    ),
  };
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
