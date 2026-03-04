"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import type { AIContentType } from "@/lib/ai/contracts";
import { canonicalizeMarkdown } from "@/lib/ai/writing/rich-text";
import type { GeneratedContent } from "@/lib/ai/writing/types";

interface ContentResponseEnvelope {
  exists: boolean;
  content: GeneratedContent | null;
}

interface UseAIContentWorkspaceOptions {
  contentType: AIContentType;
  enabled?: boolean;
  jobId: number;
  requestedVariantId?: number;
}

interface UseAIContentWorkspaceResult {
  content: GeneratedContent | null;
  contentStatusText: string | null;
  currentContent: string;
  currentVariantIndex: number;
  currentVariantPrompt: string | null;
  hasChanges: boolean;
  isContentLoading: boolean;
  isReady: boolean;
  isSaving: boolean;
  isSending: boolean;
  modificationPrompt: string;
  setEditedContent: (value: string) => void;
  setModificationPrompt: (value: string) => void;
  navigateVariant: (direction: "prev" | "next") => void;
  saveEdit: () => Promise<void>;
  sendModification: () => Promise<void>;
  resetChanges: () => void;
}

export function useAIContentWorkspace({
  contentType,
  enabled = true,
  jobId,
  requestedVariantId = 0,
}: UseAIContentWorkspaceOptions): UseAIContentWorkspaceResult {
  const bootstrapInFlightRef = useRef(false);
  const generateInFlightRef = useRef(false);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [currentVariantIndex, setCurrentVariantIndex] = useState(0);
  const [editedContent, setEditedContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [modificationPrompt, setModificationPrompt] = useState("");

  const [isContentLoading, setIsContentLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const hasInitialized = useRef(false);
  const hasChanges =
    canonicalizeMarkdown(editedContent || "") !== canonicalizeMarkdown(originalContent || "");

  const selectVariantByIndex = useCallback(
    (index: number, nextContent?: GeneratedContent | null) => {
      const source = nextContent || content;
      if (!source || source.history.length === 0) return;

      const safeIndex = Math.min(Math.max(index, 0), source.history.length - 1);
      const variantText = source.history[safeIndex]?.variant || source.content;

      setCurrentVariantIndex(safeIndex);
      setEditedContent(variantText);
      setOriginalContent(variantText);
    },
    [content]
  );

  const generateContent = useCallback(
    async (userPrompt?: string) => {
      if (!enabled) return;
      if (generateInFlightRef.current) return;
      generateInFlightRef.current = true;
      setIsContentLoading(true);

      try {
        const res = await fetch("/api/ai/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId,
            type: contentType,
            userPrompt: userPrompt || null,
          }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "Failed to generate content");
        }

        const data = await res.json();
        const nextContent = data.content as GeneratedContent;

        setContent(nextContent);
        hasInitialized.current = true;
        selectVariantByIndex(nextContent.history.length - 1, nextContent);
      } catch (error) {
        console.error("Generation error:", error);
        toast.error(error instanceof Error ? error.message : "Failed to generate content");
      } finally {
        setIsContentLoading(false);
        generateInFlightRef.current = false;
      }
    },
    [contentType, enabled, jobId, selectVariantByIndex]
  );

  const checkExistingContent = useCallback(async () => {
    if (!enabled) return;
    if (bootstrapInFlightRef.current) return;
    bootstrapInFlightRef.current = true;
    setIsContentLoading(true);

    try {
      const res = await fetch(`/api/ai/content?jobId=${jobId}&type=${contentType}`);
      if (!res.ok) {
        throw new Error("Failed to load saved content");
      }

      const data = (await res.json()) as ContentResponseEnvelope;

      if (data.exists && data.content) {
        const nextContent = data.content;
        setContent(nextContent);

        const requestedIndex = requestedVariantId
          ? nextContent.history.findIndex((item) => item.id === requestedVariantId)
          : -1;
        const targetIndex = requestedIndex >= 0 ? requestedIndex : nextContent.history.length - 1;

        selectVariantByIndex(targetIndex, nextContent);
        hasInitialized.current = true;
        return;
      }

      await generateContent();
    } catch (error) {
      console.error("Failed to load existing AI content:", error);
      toast.error("Failed to load saved content");
    } finally {
      setIsContentLoading(false);
      bootstrapInFlightRef.current = false;
    }
  }, [contentType, enabled, generateContent, jobId, requestedVariantId, selectVariantByIndex]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(jobId) || hasInitialized.current) return;
    void checkExistingContent();
  }, [checkExistingContent, enabled, jobId]);

  const saveEdit = useCallback(async () => {
    if (!content || !editedContent.trim()) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/ai/content/${content.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editedContent,
          userPrompt: "Manual edit",
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to save");
      }

      const data = await res.json();
      const nextContent = data.content as GeneratedContent;
      setContent(nextContent);
      selectVariantByIndex(nextContent.history.length - 1, nextContent);
      toast.success("Saved as new variant");
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save variant");
    } finally {
      setIsSaving(false);
    }
  }, [content, editedContent, selectVariantByIndex]);

  const sendModification = useCallback(async () => {
    if (!modificationPrompt.trim()) return;
    const prompt = modificationPrompt.trim();

    setModificationPrompt("");
    setIsSending(true);
    try {
      await generateContent(prompt);
    } finally {
      setIsSending(false);
    }
  }, [generateContent, modificationPrompt]);

  const navigateVariant = useCallback(
    (direction: "prev" | "next") => {
      if (!content || content.history.length === 0) return;
      const historyLength = content.history.length;

      const nextIndex =
        direction === "prev"
          ? currentVariantIndex > 0
            ? currentVariantIndex - 1
            : historyLength - 1
          : currentVariantIndex < historyLength - 1
            ? currentVariantIndex + 1
            : 0;

      selectVariantByIndex(nextIndex);
    },
    [content, currentVariantIndex, selectVariantByIndex]
  );

  const currentVariantPrompt = content?.history[currentVariantIndex]?.userPrompt || null;

  const currentContent = useMemo(() => {
    if (hasChanges) return editedContent;
    return content?.history[currentVariantIndex]?.variant || content?.content || "";
  }, [content, currentVariantIndex, editedContent, hasChanges]);

  const contentStatusText = isSaving
    ? "Saving variant..."
    : isSending
      ? "Generating update..."
      : isContentLoading
        ? "Updating content..."
        : null;

  const resetChanges = useCallback(() => {
    setEditedContent(originalContent);
  }, [originalContent]);

  return {
    content,
    contentStatusText,
    currentContent,
    currentVariantIndex,
    currentVariantPrompt,
    hasChanges,
    isContentLoading,
    isReady: hasInitialized.current,
    isSaving,
    isSending,
    modificationPrompt,
    navigateVariant,
    resetChanges,
    saveEdit,
    sendModification,
    setEditedContent,
    setModificationPrompt,
  };
}
