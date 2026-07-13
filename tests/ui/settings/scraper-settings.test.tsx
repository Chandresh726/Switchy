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
    historyRetentionDays: 90,
    onHistoryRetentionDaysChange: vi.fn(),
    filterCountry: "",
    filterCity: "",
    onFilterCountryChange: vi.fn(),
    onFilterCityChange: vi.fn(),
    filterTitleKeywords: [],
    onFilterTitleKeywordsChange: vi.fn(),
    onSave: vi.fn(),
    isSaving: false,
    hasUnsavedChanges: false,
    settingsSaved: false,
  };
}

describe("ScraperSettings", () => {
  it("clamps scrape history retention to the persisted 7-3650 day range", () => {
    const props = createProps();
    render(<ScraperSettings {...props} />);
    const input = screen.getByLabelText("History Retention") as HTMLInputElement;

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

  it("keeps local scrape parallelism within its supported range", () => {
    const props = createProps();
    render(<ScraperSettings {...props} />);
    const input = screen.getByLabelText(
      "Max Parallel Scrapes"
    ) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "20" } });

    expect(props.onMaxParallelScrapesChange.mock.calls).toEqual([[1], [10]]);
  });

  it("only enables saving when local settings have changed", () => {
    const props = createProps();
    const { rerender } = render(<ScraperSettings {...props} />);

    expect(
      (screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled
    ).toBe(true);

    rerender(<ScraperSettings {...props} hasUnsavedChanges />);
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton);
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });
});
