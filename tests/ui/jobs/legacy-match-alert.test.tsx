import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LegacyMatchAlert } from "@/components/jobs/legacy-match-alert";

describe("LegacyMatchAlert", () => {
  it("explains that the score is valid and can be refreshed", () => {
    render(<LegacyMatchAlert />);

    expect(screen.getByText("Legacy match score")).toBeTruthy();
    expect(screen.getByText(/rematch this job to refresh it/i)).toBeTruthy();
  });
});
