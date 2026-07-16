"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { toast } from "sonner";

import type { AIContentType } from "@/lib/ai/contracts";
import {
  aiStreamCompleteSchema,
  aiStreamDeltaSchema,
  aiStreamErrorSchema,
} from "@/lib/api/contracts/ai";
import { APIClientError } from "@/lib/api/client";
import {
  getAIContent,
  openAIContentStream,
  recordAIVariantSignal,
  saveAIContent,
} from "@/lib/api/clients/ai";
import { canonicalizeMarkdown } from "@/lib/ai/writing/rich-text";
import type { GeneratedContent } from "@/lib/ai/writing/types";
import {
  selectAdjacentVariantIndex,
  selectInitialVariantIndex,
} from "@/lib/ai/writing/workspace/variants";

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
  isDiscarding: boolean;
  isReady: boolean;
  isSaving: boolean;
  isSending: boolean;
  modificationPrompt: string;
  setEditedContent: (value: string) => void;
  setModificationPrompt: (value: string) => void;
  navigateVariant: (direction: "prev" | "next") => void;
  discardCurrentVariant: () => Promise<void>;
  recordCurrentVariantCopied: () => Promise<void>;
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
  const generationAbortRef = useRef<AbortController | null>(null);
  const [content, setContent] = useState<GeneratedContent | null>(null);
  const [currentVariantIndex, setCurrentVariantIndex] = useState(0);
  const [editedContent, setEditedContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [modificationPrompt, setModificationPrompt] = useState("");
  const [streamingContent, setStreamingContent] = useState<string | null>(null);

  const [isContentLoading, setIsContentLoading] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReady, setIsReady] = useState(false);

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

  const recordVariantSignal = useCallback(async (
    variantId: number,
    action: "selected" | "copied" | "discarded"
  ) => {
    await recordAIVariantSignal(variantId, action);
  }, []);

  const consumeContentStream = useCallback(async (
    response: Response,
    onDelta: (text: string) => void
  ): Promise<ReturnType<typeof aiStreamCompleteSchema.parse>> => {
    if (!response.body) throw new Error("Streaming response is unavailable");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete: ReturnType<typeof aiStreamCompleteSchema.parse> | null = null;

    const processFrame = (frame: string) => {
      let event = "";
      const dataLines: string[] = [];
      for (const line of frame.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (!event || dataLines.length === 0) return;
      const data: unknown = JSON.parse(dataLines.join("\n"));
      if (event === "delta") {
        onDelta(aiStreamDeltaSchema.parse(data).text);
      } else if (event === "complete") {
        complete = aiStreamCompleteSchema.parse(data);
      } else if (event === "error") {
        const streamError = aiStreamErrorSchema.parse(data);
        throw new APIClientError(
          streamError.message,
          500,
          streamError.code,
          undefined,
          streamError.requestId
        );
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        processFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim()) processFrame(buffer);
    if (!complete) throw new Error("Generation stream ended before completion");
    return complete;
  }, []);

  const generateContent = useCallback(
    async (userPrompt?: string) => {
      if (!enabled) return;
      if (generateInFlightRef.current) return;
      generateInFlightRef.current = true;
      setIsContentLoading(true);
      const abortController = new AbortController();
      generationAbortRef.current = abortController;

      try {
        const parentVariantId = userPrompt
          ? content?.history[currentVariantIndex]?.id ?? null
          : null;
        const res = await openAIContentStream({
            jobId,
            type: contentType,
            userPrompt: userPrompt || null,
            parentVariantId,
        }, abortController.signal);

        let accumulated = "";
        const data = await consumeContentStream(res, (delta) => {
          accumulated += delta;
          setStreamingContent(accumulated);
        });
        const nextContent = data.content;

        setContent(nextContent);
        hasInitialized.current = true;
        setIsReady(true);
        selectVariantByIndex(nextContent.history.length - 1, nextContent);
      } catch (error) {
        if (abortController.signal.aborted) return;
        console.error("Generation error:", error);
        toast.error(error instanceof Error ? error.message : "Failed to generate content");
      } finally {
        setIsContentLoading(false);
        setStreamingContent(null);
        if (generationAbortRef.current === abortController) generationAbortRef.current = null;
        generateInFlightRef.current = false;
      }
    },
    [content, contentType, consumeContentStream, currentVariantIndex, enabled, jobId, selectVariantByIndex]
  );

  useEffect(() => () => {
    generationAbortRef.current?.abort();
  }, []);

  const checkExistingContent = useCallback(async () => {
    if (!enabled) return;
    if (bootstrapInFlightRef.current) return;
    bootstrapInFlightRef.current = true;
    setIsContentLoading(true);

    try {
      const data = await getAIContent(jobId, contentType);

      if (data.exists && data.content) {
        const nextContent = data.content;
        setContent(nextContent);

        const targetIndex = selectInitialVariantIndex(
          nextContent.history,
          requestedVariantId
        );

        selectVariantByIndex(targetIndex, nextContent);
        const selectedVariantId = nextContent.history[targetIndex]?.id;
        if (selectedVariantId) {
          void recordVariantSignal(selectedVariantId, "selected").catch((error) => {
            console.error("Failed to record selected variant:", error);
          });
        }
        hasInitialized.current = true;
        setIsReady(true);
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
  }, [
    contentType,
    enabled,
    generateContent,
    jobId,
    recordVariantSignal,
    requestedVariantId,
    selectVariantByIndex,
  ]);

  useEffect(() => {
    if (!enabled || !Number.isFinite(jobId) || hasInitialized.current) return;
    void checkExistingContent();
  }, [checkExistingContent, enabled, jobId]);

  const saveEdit = useCallback(async () => {
    if (!content || !editedContent.trim()) return;

    setIsSaving(true);
    try {
      const data = await saveAIContent(content.id, {
          content: editedContent,
          userPrompt: "Manual edit",
          parentVariantId: content.history[currentVariantIndex]?.id ?? null,
      });
      const nextContent = data.content;
      setContent(nextContent);
      selectVariantByIndex(nextContent.history.length - 1, nextContent);
      toast.success("Saved as new variant");
    } catch (error) {
      console.error("Save error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save variant");
    } finally {
      setIsSaving(false);
    }
  }, [content, currentVariantIndex, editedContent, selectVariantByIndex]);

  const sendModification = useCallback(async () => {
    if (!modificationPrompt.trim()) return;
    if (hasChanges) {
      toast.error("Save or cancel your manual edits before asking AI for changes");
      return;
    }
    const prompt = modificationPrompt.trim();

    setModificationPrompt("");
    setIsSending(true);
    try {
      await generateContent(prompt);
    } finally {
      setIsSending(false);
    }
  }, [generateContent, hasChanges, modificationPrompt]);

  const navigateVariant = useCallback(
    (direction: "prev" | "next") => {
      if (!content || content.history.length === 0) return;
      if (isDiscarding) return;
      if (hasChanges) {
        toast.error("Save or cancel your manual edits before changing variants");
        return;
      }
      const nextIndex = selectAdjacentVariantIndex(
        content.history,
        currentVariantIndex,
        direction
      );

      selectVariantByIndex(nextIndex);
      const nextVariantId = content.history[nextIndex]?.id;
      if (nextVariantId) {
        void recordVariantSignal(nextVariantId, "selected").catch((error) => {
          console.error("Failed to record selected variant:", error);
        });
      }
    },
    [
      content,
      currentVariantIndex,
      hasChanges,
      isDiscarding,
      recordVariantSignal,
      selectVariantByIndex,
    ]
  );

  const recordCurrentVariantCopied = useCallback(async () => {
    if (hasChanges) {
      throw new Error("Save or cancel manual edits before copying");
    }
    const variantId = content?.history[currentVariantIndex]?.id;
    if (variantId) await recordVariantSignal(variantId, "copied");
  }, [content, currentVariantIndex, hasChanges, recordVariantSignal]);

  const discardCurrentVariant = useCallback(async () => {
    const variantId = content?.history[currentVariantIndex]?.id;
    if (!variantId || !content || content.history.length < 2) return;
    if (hasChanges) {
      toast.error("Save or cancel your manual edits before discarding a variant");
      return;
    }
    setIsDiscarding(true);
    try {
      await recordVariantSignal(variantId, "discarded");
      const discardedAt = new Date().toISOString();
      const nextContent = {
        ...content,
        history: content.history.map((item) => item.id === variantId
          ? { ...item, discardedAt }
          : item),
      };
      const nextIndex = selectAdjacentVariantIndex(
        nextContent.history,
        currentVariantIndex,
        "prev"
      );
      setContent(nextContent);
      selectVariantByIndex(nextIndex, nextContent);
      toast.success("Variant marked as discarded");
    } catch (error) {
      console.error("Failed to discard writing variant:", error);
      toast.error("Failed to discard variant");
    } finally {
      setIsDiscarding(false);
    }
  }, [content, currentVariantIndex, hasChanges, recordVariantSignal, selectVariantByIndex]);

  const currentVariantPrompt = content?.history[currentVariantIndex]?.userPrompt || null;

  const currentContent = useMemo(() => {
    if (streamingContent !== null) return streamingContent;
    if (hasChanges) return editedContent;
    return content?.history[currentVariantIndex]?.variant || content?.content || "";
  }, [content, currentVariantIndex, editedContent, hasChanges, streamingContent]);

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
    isDiscarding,
    isReady,
    isSaving,
    isSending,
    modificationPrompt,
    navigateVariant,
    discardCurrentVariant,
    recordCurrentVariantCopied,
    resetChanges,
    saveEdit,
    sendModification,
    setEditedContent,
    setModificationPrompt,
  };
}
