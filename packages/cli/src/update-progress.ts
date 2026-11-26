import type { UpdateProgress } from "../../../lib/runtime/update-progress.js";
import type { SwitchyPaths } from "./types.js";
import { readUpdateState, saveUpdateState } from "./lifecycle-state.js";

export type ProgressReporter = (progress: UpdateProgress, durationMs?: number) => Promise<void>;

export function updateProgressReporter(paths: SwitchyPaths): ProgressReporter {
  return async (progress, durationMs) => {
    const state = await readUpdateState(paths);
    await saveUpdateState(paths, {
      progress,
      ...(durationMs === undefined ? {} : { timings: { ...state.timings, [progress.stage]: Math.round(durationMs) } }),
    });
  };
}

export async function trackUpdateStage<T>(
  stage: UpdateProgress["stage"],
  report: ProgressReporter | undefined,
  operation: () => Promise<T>
): Promise<T> {
  await report?.({ stage });
  const started = performance.now();
  try { return await operation(); }
  finally { await report?.({ stage }, performance.now() - started); }
}
