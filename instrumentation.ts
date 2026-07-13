export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("@/lib/jobs/scheduler");
    try {
      await startScheduler();
      console.log("[Instrumentation] Scheduler started on server boot");
    } catch (error) {
      console.error("[Instrumentation] Failed to start scheduler:", error);
    }

    try {
      const { getLocalScrapeQueueService } = await import("@/lib/scraper");
      void getLocalScrapeQueueService()
        .recoverPending()
        .then(() => {
          console.log("[Instrumentation] Local scrape queue recovered on server boot");
        })
        .catch((error) => {
          console.error("[Instrumentation] Failed to recover local scrape queue:", error);
        });
    } catch (error) {
      console.error("[Instrumentation] Failed to start local scrape queue recovery:", error);
    }

    try {
      const { dispatchPendingScrapeMatches } = await import(
        "@/lib/scraper/matching/outbox"
      );
      dispatchPendingScrapeMatches();
    } catch (error) {
      console.error("[Instrumentation] Failed to recover matcher outbox:", error);
    }
  }
}
