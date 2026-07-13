import { describe, expect, it } from "vitest";

import { isRecruiterPosition } from "@/lib/people/position";

describe("isRecruiterPosition", () => {
  it("returns true for recruiter-like titles", () => {
    expect(isRecruiterPosition("Senior Talent Acquisition Partner")).toBe(true);
    expect(isRecruiterPosition("Technical Recruiter")).toBe(true);
  });

  it("returns false for non recruiter titles", () => {
    expect(isRecruiterPosition("Software Engineer")).toBe(false);
    expect(isRecruiterPosition(null)).toBe(false);
  });
});
