import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SettingsPage from "@/app/(dashboard)/settings/page";
import { APIClientError } from "@/lib/api/errors";
import { settingsResponseSchema } from "@/lib/api/contracts/settings";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getLocalCLIStatus: vi.fn(),
  getProviderModels: vi.fn(),
  getProviders: vi.fn(),
  patchSettings: vi.fn(),
  updateProvider: vi.fn(),
  updateProviderApiKey: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: mocks.toastError,
    success: mocks.toastSuccess,
    warning: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/api/clients/settings", () => ({
  getSettings: mocks.getSettings,
  patchSettings: mocks.patchSettings,
}));
vi.mock("@/lib/api/clients/providers", () => ({
  createProvider: vi.fn(),
  deleteProvider: vi.fn(),
  getLocalCLIStatus: mocks.getLocalCLIStatus,
  getProviderModels: mocks.getProviderModels,
  getProviders: mocks.getProviders,
  updateProvider: mocks.updateProvider,
  updateProviderApiKey: mocks.updateProviderApiKey,
}));
vi.mock("@/lib/api/clients/health", () => ({
  getReadiness: vi.fn().mockResolvedValue({ status: "ready", checks: { database: "ready", runtime: "ready" } }),
  getRuntimeHealth: vi.fn().mockResolvedValue({
    databaseAvailable: true,
    schedulerInitializationState: "ready",
    queueRecoveryState: "ready",
    lastSuccessfulRecoveryAt: null,
    lastSuccessfulDispatchAt: null,
    oldestQueuedWorkAgeMs: null,
    expiredLeaseCount: 0,
    lastError: null,
  }),
}));
vi.mock("@/lib/api/clients/runtime", () => ({
  getMatchSession: vi.fn(),
  getUnmatchedJobsCount: vi.fn().mockResolvedValue({ count: 0, days: 5 }),
  queueUnmatchedJobs: vi.fn(),
}));
vi.mock("@/lib/api/clients/jobs", () => ({
  clearJobMatchData: vi.fn(),
  clearJobs: vi.fn(),
}));
vi.mock("@/lib/api/clients/ai", () => ({ clearAllAIContent: vi.fn() }));

vi.mock("@/components/settings/matcher-section", () => ({ MatcherSection: () => <div>Matcher</div> }));
vi.mock("@/components/settings/danger-zone", () => ({ DangerZone: () => <div>Danger zone</div> }));
vi.mock("@/components/settings/resume-parser-section", () => ({ ResumeParserSection: () => <div>Resume parser</div> }));
vi.mock("@/components/settings/notifications-section", () => ({ NotificationsSection: () => <div>Notifications</div> }));
vi.mock("@/components/settings/system-info", () => ({ SystemInfo: () => <div>System info</div> }));
vi.mock("@/components/settings/ai-writing-section", () => ({ AIWritingSection: () => <div>AI writing</div> }));
vi.mock("@/components/settings/ai-providers-manager", () => ({
  AIProvidersManager: (props: {
    providers: Array<{ id: string; provider: string; connectionStatus?: string }>;
    onUpdateProvider: (id: string, input: { apiKey?: string | null }) => Promise<void>;
  }) => (
    <div>
      {props.providers.map((provider) => (
        <div key={provider.id}>
          {provider.provider}:{provider.connectionStatus ?? "checking"}
        </div>
      ))}
      <button
        type="button"
        onClick={() => void props.onUpdateProvider("custom-provider", { apiKey: null })}
      >
        Remove provider credential
      </button>
    </div>
  ),
}));
vi.mock("@/components/settings/scraper-settings", () => ({
  ScraperSettings: (props: {
    schedulerCron: string;
    schedulerEnabled: boolean;
    onSchedulerCronChange: (value: string) => void;
    onSchedulerEnabledChange: (value: boolean) => void;
  }) => (
    <div>
      <button type="button" onClick={() => props.onSchedulerCronChange("*/10 * * * *")}>
        cron:{props.schedulerCron}
      </button>
      <button type="button" onClick={() => props.onSchedulerEnabledChange(!props.schedulerEnabled)}>
        scheduler:{String(props.schedulerEnabled)}
      </button>
    </div>
  ),
}));

const settings = settingsResponseSchema.parse({
  job_analysis_model: "",
  job_analysis_provider_id: "",
  job_analysis_reasoning_effort: "provider_default",
  matcher_model: "",
  matcher_provider_id: "",
  resume_parser_model: "",
  resume_parser_provider_id: "",
  matcher_reasoning_effort: "provider_default",
  resume_parser_reasoning_effort: "provider_default",
  matcher_batch_size: "10",
  matcher_max_retries: "2",
  matcher_concurrency_limit: "3",
  matcher_timeout_ms: "120000",
  matcher_backoff_base_delay: "1000",
  matcher_backoff_max_delay: "10000",
  matcher_auto_match_after_scrape: "true",
  scheduler_enabled: "false",
  scheduler_cron: "0 */6 * * *",
  notifications_enabled: "false",
  notifications_enabled_at: "",
  notifications_match_score_threshold: "75",
  scraper_max_parallel_scrapes: "3",
  scraper_keep_device_awake: "true",
  scraper_history_retention_days: "90",
  scraper_stale_job_archive_days: "60",
  scraper_filter_country: "India",
  scraper_filter_city: "",
  scraper_filter_title_keywords: "[]",
  referral_tone: "professional",
  referral_length: "medium",
  follow_up_tone: "professional",
  follow_up_length: "medium",
  cover_letter_tone: "professional",
  cover_letter_length: "medium",
  cover_letter_focus: "[]",
  ai_writing_model: "",
  ai_writing_provider_id: "",
  ai_writing_reasoning_effort: "provider_default",
  codex_cli_executable: "codex",
  opencode_cli_executable: "opencode",
});

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe("settings failure recovery", () => {
  beforeEach(() => {
    mocks.getSettings.mockReset();
    mocks.getLocalCLIStatus.mockReset();
    mocks.getProviderModels.mockReset();
    mocks.getProviders.mockReset();
    mocks.patchSettings.mockReset();
    mocks.updateProvider.mockReset();
    mocks.updateProviderApiKey.mockReset();
    mocks.toastError.mockReset();
    mocks.toastSuccess.mockReset();
    mocks.getProviders.mockResolvedValue([]);
    mocks.getProviderModels.mockResolvedValue({
      providerId: "builtin:codex-cli",
      provider: "codex_cli",
      models: [],
      fetchedAt: "2026-07-23T00:00:00.000Z",
      isStale: false,
      source: "live",
    });
  });

  it("renders the settings content while a local CLI status check is pending", async () => {
    let resolveStatus: ((status: {
      status: "ready";
      selectable: true;
      cliVersion: string;
      statusMessage: string;
      lastCheckedAt: string;
    }) => void) | undefined;

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviders.mockResolvedValue([{
      id: "builtin:codex-cli",
      provider: "codex_cli",
      kind: "local_cli",
      isActive: true,
      hasApiKey: false,
      selectable: false,
      createdAt: null,
      updatedAt: null,
    }]);
    mocks.getLocalCLIStatus.mockImplementation(() => new Promise((resolve) => {
      resolveStatus = resolve;
    }));

    renderSettings();

    expect(await screen.findByText("Matcher")).toBeTruthy();
    expect(screen.getByText("codex_cli:checking")).toBeTruthy();
    expect(mocks.getLocalCLIStatus).toHaveBeenCalledWith("codex_cli");

    await act(async () => resolveStatus?.({
      status: "ready",
      selectable: true,
      cliVersion: "1.2.3",
      statusMessage: "2 text models available.",
      lastCheckedAt: "2026-07-23T00:00:00.000Z",
    }));

    expect(await screen.findByText("codex_cli:ready")).toBeTruthy();
  });

  it("preserves the null signal when removing a provider credential", async () => {
    mocks.getSettings.mockResolvedValue(settings);
    mocks.updateProviderApiKey.mockResolvedValue({ success: true });

    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Remove provider credential" }));

    await waitFor(() => expect(mocks.updateProviderApiKey).toHaveBeenCalledWith(
      "custom-provider",
      { apiKey: null }
    ));
    expect(mocks.updateProvider).not.toHaveBeenCalled();
  });

  it("renders a retryable initialization error with its request reference", async () => {
    mocks.getSettings.mockRejectedValue(
      new APIClientError("Settings unavailable", 500, "internal_error", undefined, "req-settings")
    );

    renderSettings();

    expect(await screen.findByText("Settings unavailable")).toBeTruthy();
    expect(screen.getByText("Request ID: req-settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("attempts one autosave per snapshot and explicitly retries the identical snapshot", async () => {
    mocks.getSettings.mockResolvedValue(settings);
    mocks.patchSettings
      .mockRejectedValueOnce(new Error("Temporary save failure"))
      .mockResolvedValueOnce({ ...settings, scheduler_cron: "*/10 * * * *" });

    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: `cron:${settings.scheduler_cron}` }));

    await waitFor(() => expect(mocks.patchSettings).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(mocks.patchSettings).toHaveBeenCalledTimes(1);
    const options = mocks.toastError.mock.calls[0]?.[1] as {
      action?: { onClick?: () => void };
    } | undefined;
    options?.action?.onClick?.();

    await waitFor(() => expect(mocks.patchSettings).toHaveBeenCalledTimes(2));
    expect(mocks.patchSettings.mock.calls[1]?.[0]).toEqual(mocks.patchSettings.mock.calls[0]?.[0]);
  });

  it("rolls scheduler state back when its optimistic update is rejected", async () => {
    mocks.getSettings.mockResolvedValue(settings);
    mocks.patchSettings.mockRejectedValueOnce(new Error("Scheduler save failed"));

    renderSettings();
    const toggle = await screen.findByRole("button", { name: "scheduler:false" });
    fireEvent.click(toggle);
    expect(await screen.findByRole("button", { name: "scheduler:true" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "scheduler:false" })).toBeTruthy();
    expect(mocks.patchSettings).toHaveBeenCalledWith({ scheduler_enabled: true });
  });
});
