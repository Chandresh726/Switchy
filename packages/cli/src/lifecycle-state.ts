import path from "node:path";

import { saveUpdateState as saveState } from "../../../lib/runtime/lifecycle-state.js";
import type { LifecyclePaths, UpdateState } from "../../../lib/runtime/lifecycle-state.js";
import { withDirectoryLock } from "./files.js";

export {
  compareVersions, predatesCurrentBoot, lifecycleFiles, readPreferences, readUpdateState,
} from "../../../lib/runtime/lifecycle-state.js";
export type {
  LifecyclePreferences, UpdateTransaction,
} from "../../../lib/runtime/lifecycle-state.js";
export { syncDirectory } from "../../../lib/runtime/atomic-file.js";
export { enqueueUpdateRequest, nextUpdateRequest } from "../../../lib/runtime/update-requests.js";

export async function saveUpdateState(paths: LifecyclePaths, changes: Partial<UpdateState>): Promise<void> {
  await withDirectoryLock(path.join(paths.runtime, "update-state.lock"), () => saveState(paths, changes));
}
