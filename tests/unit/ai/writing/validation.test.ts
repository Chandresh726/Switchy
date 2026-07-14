import { describe, expect, it } from "vitest";

import { isValidWritingOutput } from "@/lib/ai/writing/validation";

const coverLetter = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ");

describe("writing output validation", () => {
  it("accepts grounded Markdown with an allowlisted link", () => {
    const link = "https://example.com/jobs/1";
    expect(isValidWritingOutput({
      type: "cover_letter",
      text: `${coverLetter} [${link}](${link})`,
      profileName: "Candidate",
      allowedLinks: [link],
    })).toBe(true);
  });

  it("rejects invented links, disallowed Markdown, and unexpected placeholders", () => {
    expect(isValidWritingOutput({
      type: "cover_letter",
      text: `${coverLetter} https://evil.example/collect`,
      profileName: "Candidate",
      allowedLinks: ["https://example.com/jobs/1"],
    })).toBe(false);
    expect(isValidWritingOutput({
      type: "cover_letter",
      text: `# Heading\n${coverLetter}`,
      profileName: "Candidate",
      allowedLinks: [],
    })).toBe(false);
    expect(isValidWritingOutput({
      type: "cover_letter",
      text: `${coverLetter} {{candidate_name}}`,
      profileName: "Candidate",
      allowedLinks: [],
    })).toBe(false);
    expect(isValidWritingOutput({
      type: "cover_letter",
      text: `${coverLetter} [contact](mailto:invented@example.com)`,
      profileName: "Candidate",
      allowedLinks: [],
    })).toBe(false);
    expect(isValidWritingOutput({
      type: "cover_letter",
      text: `${coverLetter} [site](/invented)`,
      profileName: "Candidate",
      allowedLinks: [],
    })).toBe(false);
  });

  it("requires the connection placeholder and first-person recruiter perspective", () => {
    const valid = "Hi {{connection_first_name}}, I applied for this role and would appreciate a quick review of my application. Thank you for your time.";
    expect(isValidWritingOutput({
      type: "recruiter_follow_up",
      text: valid,
      profileName: "Candidate",
      allowedLinks: [],
    })).toBe(true);
    expect(isValidWritingOutput({
      type: "recruiter_follow_up",
      text: "The candidate applied for this role and would appreciate a quick review of the application. Thank you for your time and consideration.",
      profileName: "Candidate",
      allowedLinks: [],
    })).toBe(false);
  });
});
