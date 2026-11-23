import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./atomic-file";
import { lifecycleFiles, type LifecyclePaths } from "./lifecycle-state";

export interface UpdateRequest {
  id: string;
  action: "check" | "download" | "install";
  version?: string;
}

export async function enqueueUpdateRequest(paths: LifecyclePaths, action: UpdateRequest["action"], version?: string): Promise<UpdateRequest> {
  const request = { id: randomUUID(), action, ...(version ? { version } : {}) };
  const directory = lifecycleFiles(paths).requests;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeJsonFileAtomic(path.join(directory, `${Date.now()}-${request.id}.json`), request);
  return request;
}

export async function nextUpdateRequest(paths: LifecyclePaths): Promise<{ request: UpdateRequest; file: string } | null> {
  const directory = lifecycleFiles(paths).requests;
  const names = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of names.filter((name) => /^\d+-[a-f0-9-]+\.json$/u.test(name)).sort()) {
    const file = path.join(directory, name);
    const request = await readJsonFile<UpdateRequest>(file);
    if (request && typeof request.id === "string" && ["check", "download", "install"].includes(request.action)
      && (request.version === undefined || /^\d+\.\d+\.\d+$/u.test(request.version))) return { request, file };
    throw new Error("Invalid Switchy update request");
  }
  return null;
}
