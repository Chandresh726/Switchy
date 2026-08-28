export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const {
      logRuntimeEvent,
      recordRuntimeError,
      setLegacyMatchImportRecovery,
      setMatcherDispatchRecovery,
      setScrapeQueueRecovery,
      setSchedulerInitialization,
    } = await import("@/lib/runtime/health");
    const { registerRuntimeLock } = await import("@/lib/state/runtime-lock");
    registerRuntimeLock();

    try {
      const { aiRunRepository } = await import("@/lib/ai/runtime");
      const abandoned = await aiRunRepository.reconcileAbandonedRuns();
      if (abandoned > 0) {
        console.log(`[Instrumentation] Reconciled ${abandoned} interrupted AI run(s)`);
      }
    } catch (error) {
      console.error("[Instrumentation] Failed to reconcile interrupted AI runs:", error);
    }

    try {
      const { reconcileResumeStorage } = await import(
        "@/lib/application/profile-resume-service"
      );
      const result = await reconcileResumeStorage();
      if (result.ready + result.deleted + result.missing + result.orphanedDeleted > 0) {
        console.log("[Instrumentation] Reconciled interrupted resume storage operations");
      }
    } catch (error) {
      console.error("[Instrumentation] Failed to reconcile resume storage:", error);
    }

    try {
      const { reconcileConfiguredLocalCLIProviders } = await import(
        "@/lib/ai/providers/provider-service"
      );
      const configuredLocalCLIProviders = await reconcileConfiguredLocalCLIProviders();
      const { removeDeprecatedMatchingPreferenceSettings } = await import(
        "@/lib/settings/settings-service"
      );
      await removeDeprecatedMatchingPreferenceSettings();
      const { warmLocalCLIStatuses } = await import("@/lib/ai/local-cli/service");
      void warmLocalCLIStatuses(configuredLocalCLIProviders).catch((error) => {
        console.error("[Instrumentation] Failed to check local CLI providers:", error);
      });
    } catch (error) {
      console.error("[Instrumentation] Failed to initialize local CLI providers:", error);
    }

    const { migrateSchedulerRecoveryState, startScheduler } = await import("@/lib/jobs/scheduler");
    try {
      migrateSchedulerRecoveryState();
      await startScheduler();
      setSchedulerInitialization("ready");
      logRuntimeEvent("scheduler", "scheduler_initialized");
    } catch (error) {
      setSchedulerInitialization("failed");
      recordRuntimeError("scheduler", "scheduler_initialization_failed");
      console.error("[Instrumentation] Failed to start scheduler:", error);
    }

    setScrapeQueueRecovery("pending");
    setMatcherDispatchRecovery("pending");
    setLegacyMatchImportRecovery("pending");
    const recoverySessionId = crypto.randomUUID();
    void (async () => {
      const scrapeRecovery = (async () => {
        const { getLocalScrapeQueueService } = await import("@/lib/scraper");
        try {
          await getLocalScrapeQueueService().recoverPending();
          setScrapeQueueRecovery("ready");
        } catch (error) {
          setScrapeQueueRecovery("failed");
          logRuntimeEvent("queue", "scrape_queue_recovery_failed", {
            sessionId: recoverySessionId,
            code: "scrape_queue_recovery_failed",
          });
          console.error("[Instrumentation] Failed to recover local scrape queue:", error);
          throw error;
        }
      })();
      const matcherRecovery = (async () => {
        const { dispatchPendingAIWork, importLegacyMatchWork } = await import(
          "@/lib/ai/work-items"
        );
        let legacyImportError: unknown;
        try {
          const imported = importLegacyMatchWork();
          if (imported > 0) {
            console.log(`[Instrumentation] Imported ${imported} legacy matcher work items`);
          }
          setLegacyMatchImportRecovery("ready");
        } catch (error) {
          legacyImportError = error;
          setLegacyMatchImportRecovery("failed");
          logRuntimeEvent("matcher", "legacy_match_import_failed", {
            sessionId: recoverySessionId,
            code: "legacy_match_import_failed",
          });
          console.error("[Instrumentation] Failed to import legacy matcher outbox:", error);
        }
        try {
          await dispatchPendingAIWork();
          setMatcherDispatchRecovery("ready");
        } catch (error) {
          setMatcherDispatchRecovery("failed");
          logRuntimeEvent("matcher", "matcher_recovery_failed", {
            sessionId: recoverySessionId,
            code: "matcher_recovery_failed",
          });
          console.error("[Instrumentation] Failed to recover matcher outbox:", error);
          throw error;
        }
        if (legacyImportError) throw legacyImportError;
      })();
      const results = await Promise.allSettled([scrapeRecovery, matcherRecovery]);
      if (results.every((result) => result.status === "fulfilled")) {
        logRuntimeEvent("queue", "queue_recovery_completed", { sessionId: recoverySessionId });
      } else {
        recordRuntimeError("queue", "queue_recovery_failed");
        logRuntimeEvent("queue", "queue_recovery_failed", {
          sessionId: recoverySessionId,
          code: "queue_recovery_failed",
        });
      }
      const { reconcileMatchNotifications } = await import("@/lib/notifications/service");
      await reconcileMatchNotifications();
    })();
  }
}
