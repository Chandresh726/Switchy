"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageCircle, FileText, Users } from "lucide-react";
import { toast } from "sonner";

import { AIContentEditor } from "@/components/ai-content-editor";
import { Button } from "@/components/ui/button";
import type { GeneratedContent } from "@/lib/ai/writing/types";

interface JobAIActionsProps {
  jobId: number;
  jobTitle: string;
  companyName: string;
  companyId: number;
}

type AIAction = "referral" | "cover-letter";

export function JobAIActions({ jobId, jobTitle, companyName, companyId }: JobAIActionsProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);

  const apiType = "cover_letter";

  const generateContent = useCallback(async (userPrompt?: string, hadContentBefore: boolean = false) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/ai/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          type: apiType,
          userPrompt: userPrompt || null,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to generate");
      }

      const data = await res.json();
      setGeneratedContent(data.content);
    } catch (error) {
      console.error("Generation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to generate content");
      if (!hadContentBefore) {
        setIsOpen(false);
      }
    } finally {
      setIsLoading(false);
    }
  }, [jobId, apiType]);

  const checkExistingContent = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/ai/content?jobId=${jobId}&type=${apiType}`);
      const data = await res.json();

      if (data.exists && data.content) {
        setGeneratedContent(data.content);
      } else {
        await generateContent(undefined, false);
      }
    } catch (error) {
      console.error("Error checking content:", error);
      await generateContent(undefined, false);
    } finally {
      setIsLoading(false);
    }
  }, [jobId, apiType, generateContent]);

  useEffect(() => {
    if (isOpen) {
      checkExistingContent();
    }
  }, [isOpen, checkExistingContent]);

  const saveEdit = async (newContent: string, userPrompt?: string) => {
    if (!generatedContent) return;

    const res = await fetch(`/api/ai/content/${generatedContent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: newContent,
        userPrompt: userPrompt || "Manual edit",
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || "Failed to save");
    }

    const data = await res.json();
    setGeneratedContent(data.content);
  };

  const handleGenerate = async (action: AIAction) => {
    if (action === "referral") {
      router.push(`/jobs/${jobId}/referral-send`);
      return;
    }
    window.scrollTo({ top: 0, behavior: "instant" });
    setIsOpen(true);
    setGeneratedContent(null);
  };

  const title = "Cover Letter";
  const description = `Cover letter for ${jobTitle} at ${companyName}`;

  const typeConfig = {
    icon: FileText,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleGenerate("referral")}
          className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
        >
          <MessageCircle className="h-4 w-4" />
          Get Referral
        </Button>

        <Button
          variant="outline"
          size="sm"
          asChild
          className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
        >
          <Link href={`/companies/${companyId}/connections`}>
            <Users className="h-4 w-4" />
            View Connections
          </Link>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => handleGenerate("cover-letter")}
          className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
        >
          <FileText className="h-4 w-4" />
          Cover Letter
        </Button>
      </div>

      <AIContentEditor
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        content={generatedContent}
        isLoading={isLoading}
        onGenerate={generateContent}
        onSaveEdit={saveEdit}
        title={title}
        description={description}
        typeConfig={typeConfig}
      />
    </>
  );
}
