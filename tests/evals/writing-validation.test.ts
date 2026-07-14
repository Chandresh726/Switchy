import { describe, expect, it } from "vitest";

import { isValidWritingOutput } from "@/lib/ai/writing/validation";

describe("writing validator evaluation", () => {
  it("accepts grounded prose and rejects unsafe links and low-signal drafts", () => {
    const validCoverLetter = `I am excited to apply for this engineering role. My experience building reliable TypeScript systems and local-first products aligns with the team's needs. I have delivered resilient background workers, accessible React interfaces, and carefully tested SQLite workflows. I would welcome the opportunity to bring that practical experience to the team.`;

    expect(isValidWritingOutput({
      type: "cover_letter",
      text: validCoverLetter,
      profileName: "Alex Rivera",
      allowedLinks: [],
    })).toBe(true);
    expect(isValidWritingOutput({
      type: "referral",
      text: "Please review my experience at https://untrusted.example and consider {{connection_first_name}} for context.",
      profileName: "Alex Rivera",
      allowedLinks: [],
    })).toBe(false);
    expect(isValidWritingOutput({
      type: "referral",
      text: "test",
      profileName: "Alex Rivera",
      allowedLinks: [],
    })).toBe(false);
  });
});
