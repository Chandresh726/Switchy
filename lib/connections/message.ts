import { isLinkedInProfileUrl } from "@/lib/connections/normalize";

type MessageTone = "concise" | "professional" | "friendly";

interface ReferralMessageInput {
  firstName: string;
  companyName: string;
  jobTitle?: string | null;
  jobUrl?: string | null;
  tone?: MessageTone;
}

function getToneBody(input: ReferralMessageInput, tone: MessageTone): string {
  const roleLine = input.jobTitle
    ? `I noticed an opening for ${input.jobTitle} at ${input.companyName}`
    : `I am exploring opportunities at ${input.companyName}`;

  const linkLine = input.jobUrl ? `Job link: ${input.jobUrl}` : "";

  if (tone === "concise") {
    return [
      `Hi ${input.firstName},`,
      "",
      `${roleLine}. If you have a moment, would you be open to referring me?`,
      linkLine,
      "",
      "Thank you!",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (tone === "friendly") {
    return [
      `Hi ${input.firstName},`,
      "",
      `Hope you're doing well. ${roleLine}, and I'd really appreciate your help with a referral if you feel comfortable.`,
      linkLine,
      "",
      "Thanks so much for considering it.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `Hi ${input.firstName},`,
    "",
    `I hope you are doing well. ${roleLine}. I would appreciate it if you could consider referring me for the role.`,
    linkLine,
    "",
    "Thank you for your time and support.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReferralMessage(input: ReferralMessageInput): string {
  const tone = input.tone || "professional";
  const firstName = input.firstName?.trim() || "there";

  return getToneBody(
    {
      ...input,
      firstName,
    },
    tone
  );
}

export function canOpenLinkedInProfile(profileUrl: string): boolean {
  return isLinkedInProfileUrl(profileUrl);
}
