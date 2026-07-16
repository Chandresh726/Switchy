export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerRuntimeLock } = await import("@/lib/state/runtime-lock");
    registerRuntimeLock();

    try {
      const { ensureBuiltinLocalCLIProviders } = await import(
        "@/lib/ai/providers/provider-service"
      );
      await ensureBuiltinLocalCLIProviders();
      const { removeDeprecatedMatchingPreferenceSettings } = await import(
        "@/lib/settings/settings-service"
      );
      await removeDeprecatedMatchingPreferenceSettings();
      const { warmLocalCLIStatuses } = await import("@/lib/ai/local-cli/service");
      void warmLocalCLIStatuses().catch((error) => {
        console.error("[Instrumentation] Failed to check local CLI providers:", error);
      });
    } catch (error) {
      console.error("[Instrumentation] Failed to initialize local CLI providers:", error);
    }

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
      const { dispatchPendingAIWork, importLegacyMatchWork } = await import(
        "@/lib/ai/work-items"
      );
      try {
        const imported = importLegacyMatchWork();
        if (imported > 0) {
          console.log(`[Instrumentation] Imported ${imported} legacy matcher work items`);
        }
      } catch (error) {
        console.error("[Instrumentation] Failed to import legacy matcher outbox:", error);
      }
      try {
        dispatchPendingAIWork();
      } catch (error) {
        console.error("[Instrumentation] Failed to recover matcher outbox:", error);
      }
    } catch (error) {
      console.error("[Instrumentation] Failed to load matcher recovery:", error);
    }
  }
}
