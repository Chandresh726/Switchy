"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { FileText, MessageCircle, Send, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getWorkspacePath } from "@/lib/ai/writing/workspace/routes";
import type { AIContentType } from "@/lib/ai/contracts";

interface JobAIActionsProps {
  jobId: number;
  companyId: number;
  jobStatus: string;
}

export function JobAIActions({
  companyId,
  jobId,
  jobStatus,
}: JobAIActionsProps) {
  const router = useRouter();
  const primaryType: AIContentType =
    jobStatus === "applied" ? "recruiter_follow_up" : "referral";
  const primaryLabel =
    primaryType === "recruiter_follow_up" ? "Message Recruiter" : "Get Referral";
  const PrimaryIcon = primaryType === "recruiter_follow_up" ? Send : MessageCircle;
  const primaryClassName =
    primaryType === "recruiter_follow_up"
      ? "border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
      : "border-purple-500/30 text-purple-400 hover:bg-purple-500/10";

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(getWorkspacePath(jobId, primaryType))}
        className={primaryClassName}
      >
        <PrimaryIcon className="h-4 w-4" />
        {primaryLabel}
      </Button>

      <Button
        variant="outline"
        size="sm"
        asChild
        className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
      >
        <Link href={`/companies/${companyId}/people`}>
          <Users className="h-4 w-4" />
          View People
        </Link>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(getWorkspacePath(jobId, "cover_letter"))}
        className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
      >
        <FileText className="h-4 w-4" />
        Cover Letter
      </Button>
    </div>
  );
}
