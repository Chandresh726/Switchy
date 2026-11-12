import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock("@/lib/api/clients/settings", () => ({ patchSettings: mocks.patch }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/settings/model-combobox", () => ({ ModelCombobox: () => <div>Model selector</div> }));
vi.mock("@/components/settings/reasoning-effort-control", () => ({ ReasoningEffortControl: () => null }));

import { MatcherFallbackSettings } from "@/components/settings/matcher-fallback-settings";
import { settingsResponseSchema } from "@/lib/api/contracts/settings";

const settings = () => settingsResponseSchema.parse({
  ...Object.fromEntries(["job_analysis_model", "job_analysis_provider_id", "job_analysis_reasoning_effort",
    "matcher_model", "matcher_provider_id", "resume_parser_model", "resume_parser_provider_id", "matcher_reasoning_effort", "resume_parser_reasoning_effort",
    "matcher_batch_size", "matcher_max_retries", "matcher_concurrency_limit", "matcher_timeout_ms", "matcher_backoff_base_delay", "matcher_backoff_max_delay", "matcher_auto_match_after_scrape",
    "scheduler_enabled", "scheduler_cron", "notifications_enabled", "notifications_enabled_at", "notifications_match_score_threshold", "scraper_max_parallel_scrapes", "scraper_keep_device_awake", "scraper_history_retention_days", "scraper_stale_job_archive_days", "scraper_filter_country", "scraper_filter_city", "scraper_filter_title_keywords",
    "referral_tone", "referral_length", "follow_up_tone", "follow_up_length", "cover_letter_tone", "cover_letter_length", "cover_letter_focus", "ai_writing_model", "ai_writing_provider_id", "ai_writing_reasoning_effort", "codex_cli_executable", "opencode_cli_executable"].map((key) => [key, ""])),
});

describe("matching fallback settings", () => {
  it("keeps routes disabled until configured and saves stages independently", async () => {
    const saved = settings();
    mocks.patch.mockResolvedValue(saved);
    render(<QueryClientProvider client={new QueryClient()}>
      <MatcherFallbackSettings settings={saved} providers={[]} modelsByProvider={{}} />
    </QueryClientProvider>);
    expect(screen.getByRole("switch", { name: "Job analysis fallback" }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save job analysis fallback" }));
    await waitFor(() => expect(mocks.patch).toHaveBeenCalledWith({ job_analysis_fallback_enabled: "false",
      job_analysis_fallback_provider_id: "", job_analysis_fallback_model: "", job_analysis_fallback_reasoning_effort: "" }));
    fireEvent.click(screen.getByRole("switch", { name: "Match evaluation fallback" }));
    expect(screen.getByRole("button", { name: "Save match evaluation fallback" }).hasAttribute("disabled")).toBe(true);
  });
});
