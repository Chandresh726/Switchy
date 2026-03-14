"use client";

import { MessageCircle } from "lucide-react";

import { AIWorkspacePage } from "@/components/ai-workspace/ai-workspace-page";

export default function ReferralSendPage() {
  return (
    <AIWorkspacePage
      contentType="referral"
      emptyStateDescription="Unable to load the job for referral outreach."
      icon={MessageCircle}
      iconClassName="text-purple-400"
      peoplePanelDescription="Copy a personalized referral message and open their profile to send manually."
      peoplePanelEnabled
      peoplePanelTitle="People at this company"
      peoplePanelToggleLabel="Ask People"
      title="Referral Workspace"
      workspaceHint="Generate variants, iterate edits, then lock a message to send to your network."
    />
  );
}
