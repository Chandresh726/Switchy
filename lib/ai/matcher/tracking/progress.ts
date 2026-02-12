import type { MatchProgressCallback } from "../types";

export function createProgressTracker(
  total: number,
  onProgress?: MatchProgressCallback
) {
  let completed = 0;
  let succeeded = 0;
  let failed = 0;
  let phase: "queued" | "matching" | "completed" = "matching";
  let queuePosition = 0;

  const report = () => {
    onProgress?.({
      phase,
      queuePosition,
      completed,
      total,
      succeeded,
      failed,
    });
  };

  return {
    setQueuePosition(position: number) {
      queuePosition = position;
      report();
    },

    setPhase(newPhase: "queued" | "matching" | "completed") {
      phase = newPhase;
      report();
    },

    incrementCompleted(success: boolean) {
      completed++;
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
      report();
    },

    addCompleted(count: number, successCount: number) {
      completed += count;
      succeeded += successCount;
      failed += count - successCount;
      report();
    },

    setStats(stats: { completed: number; succeeded: number; failed: number }) {
      completed = stats.completed;
      succeeded = stats.succeeded;
      failed = stats.failed;
      report();
    },

    getStats() {
      return { completed, succeeded, failed, total, phase, queuePosition };
    },

    complete() {
      phase = "completed";
      report();
    },
  };
}

export type ProgressTracker = ReturnType<typeof createProgressTracker>;
