export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/jobs/scheduler");
    try {
      await startScheduler();
      console.log("[Instrumentation] Scheduler started on server boot");
    } catch (error) {
      console.error("[Instrumentation] Failed to start scheduler:", error);
    }
  }
}
