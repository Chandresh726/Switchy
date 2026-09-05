import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ScraperSettings } from "@/components/settings/scraper-settings";

function createProps() {
  return {
    schedulerEnabled: false,
    onSchedulerEnabledChange: vi.fn(),
    schedulerCron: "0 */6 * * *",
    onSchedulerCronChange: vi.fn(),
    maxParallelScrapes: 3,
    onMaxParallelScrapesChange: vi.fn(),
    keepDeviceAwake: true,
    onKeepDeviceAwakeChange: vi.fn(),
    historyRetentionDays: 60,
    onHistoryRetentionDaysChange: vi.fn(),
    staleJobArchiveDays: 60,
    onStaleJobArchiveDaysChange: vi.fn(),
    filterCountry: "",
    filterCity: "",
    onFilterCountryChange: vi.fn(),
    onFilterCityChange: vi.fn(),
    filterTitleKeywords: [],
    onFilterTitleKeywordsChange: vi.fn(),
  };
}

describe("ScraperSettings", () => {
  it("clamps scrape history retention to the persisted 7-3650 day range", () => {
    const props = createProps();
    render(<ScraperSettings {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));
    const input = screen.getByLabelText(
      "History Retention (days)"
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(props.onHistoryRetentionDaysChange.mock.calls).toEqual([
      [7],
      [3650],
      [7],
    ]);
    expect(input.min).toBe("7");
    expect(input.max).toBe("3650");
  });

  it("clamps stale job archive to the persisted 7-3650 day range", () => {
    const props = createProps();
    render(<ScraperSettings {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));
    const input = screen.getByLabelText(
      "Stale Job Archive (days)"
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.change(input, { target: { value: "9999" } });
    fireEvent.change(input, { target: { value: "" } });

    expect(props.onStaleJobArchiveDaysChange.mock.calls).toEqual([
      [7],
      [3650],
      [7],
    ]);
    expect(input.min).toBe("7");
    expect(input.max).toBe("3650");
  });

  it("keeps local scrape parallelism within its supported range", () => {    const props = createProps();
    render(<ScraperSettings {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Show advanced" }));
    const input = screen.getByLabelText(
      "Max Parallel Scrapes"
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "20" } });

    expect(props.onMaxParallelScrapesChange.mock.calls).toEqual([[1], [10]]);
  });

  it("keeps operational tuning behind Advanced settings", () => {
    render(<ScraperSettings {...createProps()} />);

    expect(screen.getByLabelText("Scheduler Frequency")).toBeTruthy();
    expect(screen.getByRole("checkbox", {
      name: "Keep Mac awake while scraping",
    })).toBeTruthy();
    expect(screen.getByLabelText("Country")).toBeTruthy();
    expect(screen.getByLabelText("City")).toBeTruthy();
    expect(screen.getByLabelText("Job Title Keywords")).toBeTruthy();
    expect(
      screen.getByText("Tune throughput and retained run history.")
    ).toBeTruthy();
    expect(screen.queryByLabelText("Max Parallel Scrapes")).toBeNull();
    expect(screen.queryByLabelText("History Retention (days)")).toBeNull();
    expect(screen.queryByLabelText("Stale Job Archive (days)")).toBeNull();

    const advancedButton = screen.getByRole("button", {
      name: "Show advanced",
    });
    expect(advancedButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(advancedButton);

    expect(screen.getByLabelText("Max Parallel Scrapes")).toBeTruthy();
    expect(screen.getByLabelText("History Retention (days)")).toBeTruthy();
    expect(screen.getByLabelText("Stale Job Archive (days)")).toBeTruthy();
    expect(screen.getByText("1–10 concurrent scrapes.")).toBeTruthy();
    expect(screen.getByText("Logs expire; jobs stay.")).toBeTruthy();
    expect(screen.getByText("Archive stale jobs; applied stays.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide advanced" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("explains and toggles macOS idle-sleep prevention", () => {
    const props = createProps();
    render(<ScraperSettings {...props} />);

    expect(screen.getByText("macOS")).toBeTruthy();
    expect(screen.getByText("Only while scrape work is active.")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Keep Mac awake while scraping" })
    );
    expect(props.onKeepDeviceAwakeChange).toHaveBeenCalledWith(false);
  });
});
