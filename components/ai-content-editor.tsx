"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Copy, Check, X, ChevronLeft, ChevronRight, ArrowUp, Save } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { GeneratedContent } from "@/lib/ai/writing/types";

interface AIContentEditorProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  content: GeneratedContent | null;
  isLoading: boolean;
  onGenerate: (userPrompt?: string) => Promise<void>;
  onSaveEdit: (newContent: string, userPrompt?: string) => Promise<void>;
  title: string;
  description: string;
  typeConfig: {
    icon: React.ElementType;
    color: string;
    bgColor: string;
  };
}

export function AIContentEditor({
  isOpen,
  onOpenChange,
  content,
  isLoading,
  onGenerate,
  onSaveEdit,
  title,
  description,
  typeConfig,
}: AIContentEditorProps) {
  const [currentVariantIndex, setCurrentVariantIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [modificationPrompt, setModificationPrompt] = useState("");
  const [editedContent, setEditedContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const TypeIcon = typeConfig.icon;

  useEffect(() => {
    if (content && isOpen) {
      const latestContent = content.history[content.history.length - 1]?.variant || content.content;
      setCurrentVariantIndex(content.history.length - 1);
      setEditedContent(latestContent);
      setOriginalContent(latestContent);
      setHasChanges(false);
    }
  }, [content, isOpen]);

  // Prevent scroll on main content when drawer is open
  useEffect(() => {
    const mainContent = document.getElementById('main-content');
    if (!mainContent) return;

    if (isOpen) {
      mainContent.style.overflow = 'hidden';
    } else {
      mainContent.style.overflow = '';
    }

    return () => {
      mainContent.style.overflow = '';
    };
  }, [isOpen]);

  // Prevent scroll on drawer from bubbling
  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer || !isOpen) return;

    const preventScroll = (e: Event) => {
      e.stopPropagation();
    };

    drawer.addEventListener('wheel', preventScroll, { passive: false });
    drawer.addEventListener('touchmove', preventScroll, { passive: false });
    
    return () => {
      drawer.removeEventListener('wheel', preventScroll);
      drawer.removeEventListener('touchmove', preventScroll);
    };
  }, [isOpen]);

  const currentVariant = content?.history[currentVariantIndex];
  const contentToDisplay = currentVariant?.variant || content?.content || "";

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setEditedContent(newValue);
    setHasChanges(newValue !== originalContent);
  };

  const handleCopy = async () => {
    const textToCopy = hasChanges ? editedContent : contentToDisplay;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard in handleCopy:", err);
      toast.error("Failed to copy");
    }
  };

  const handleCancelChanges = () => {
    setEditedContent(originalContent);
    setHasChanges(false);
  };

  const handleSaveEdit = async () => {
    if (!editedContent.trim() || !content) return;
    setIsSaving(true);
    try {
      await onSaveEdit(editedContent, "Manual edit");
      setOriginalContent(editedContent);
      setHasChanges(false);
      toast.success("Saved as new variant");
    } catch (error) {
      console.error("Save error:", error);
      toast.error("Failed to save");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendModification = async () => {
    if (!modificationPrompt.trim()) return;
    setIsSending(true);
    const prompt = modificationPrompt;
    setModificationPrompt("");
    try {
      await onGenerate(prompt);
    } catch (error) {
      console.error("Failed to generate modification:", error);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (modificationPrompt.trim()) {
        handleSendModification();
      }
    }
  };

  const navigateVariant = (direction: "prev" | "next") => {
    if (!content?.history) return;
    const historyLength = content.history.length;
    const newIndex = direction === "prev"
      ? (currentVariantIndex > 0 ? currentVariantIndex - 1 : historyLength - 1)
      : (currentVariantIndex < historyLength - 1 ? currentVariantIndex + 1 : 0);
    
    setCurrentVariantIndex(newIndex);
    const selectedVariant = content.history[newIndex]?.variant || content.content;
    setEditedContent(selectedVariant);
    setOriginalContent(selectedVariant);
    setHasChanges(false);
  };

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Small delay to allow animation to work
      requestAnimationFrame(() => {
        setIsVisible(true);
      });
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none">
      {/* Overlay - covers entire main content with blur */}
      <div 
        className={cn(
          "absolute inset-0 bg-black/60 backdrop-blur-[2px] pointer-events-auto cursor-pointer transition-opacity duration-300",
          isVisible ? "opacity-100" : "opacity-0"
        )}
        onClick={handleClose}
        aria-hidden="true"
      />
      
      {/* Drawer Panel - positioned at bottom, slides up */}
      <div
        ref={drawerRef}
        className={cn(
          "absolute left-0 right-0 bg-zinc-950 border-t border-zinc-800 shadow-2xl pointer-events-auto z-10 transition-transform duration-300 ease-out flex flex-col",
          isVisible ? "translate-y-0" : "translate-y-full"
        )}
        style={{
          overscrollBehavior: 'contain',
          bottom: 0,
          maxHeight: '80vh'
        }}
      >
        {/* Section 1: Header */}
        <div className="border-b border-zinc-800 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
                {title}
              </h2>
              <p className="mt-2 text-sm text-zinc-400">{description}</p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              className="h-7 w-7 rounded-none text-zinc-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Section 2: Variant selector + User prompt */}
        {content && content.history.length > 1 && (
          <div className="px-6 py-4 border-b border-zinc-800">
            <div className="flex items-center gap-4 flex-wrap">
              {/* Variant Navigation */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigateVariant("prev")}
                  className="h-7 w-7 rounded-none border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-zinc-500 min-w-[100px] text-center font-medium">
                  Variant {currentVariantIndex + 1} of {content.history.length}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigateVariant("next")}
                  className="h-7 w-7 rounded-none border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* User Prompt */}
              {currentVariant?.userPrompt && (
                <div className="flex-1 min-w-0">
                  <div className="text-xs px-2.5 py-1.5 border border-zinc-800 bg-zinc-950/30 inline-flex items-center rounded-none">
                    {currentVariant.userPrompt === "Manual edit" ? (
                      <span className="text-zinc-400">Manual edit</span>
                    ) : (
                      <>
                        <span className="text-zinc-500 mr-2">Request:</span>
                        <span className="text-zinc-300 truncate">{currentVariant.userPrompt}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Content Viewer/Editor - with max-height and scroll */}
        <div className="px-6 py-4 flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-[200px]">
              <Loader2 className={cn("h-6 w-6 animate-spin", typeConfig.color)} />
              <span className="ml-2 text-sm text-zinc-400">Generating content...</span>
            </div>
          ) : (
            <div className="relative">
              {/* Content Container */}
              <div className="relative border border-zinc-800 bg-zinc-950/30">
                {/* Copy button - fixed top right */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopy}
                  disabled={isLoading}
                  className="absolute top-2 right-2 h-7 w-7 rounded-none text-zinc-400 hover:text-white z-20"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>

                {/* Save/Cancel buttons - fixed bottom right */}
                {hasChanges && (
                  <div className="absolute bottom-2 right-2 flex items-center gap-2 z-20">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelChanges}
                      className="h-7 rounded-none border-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-800"
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveEdit}
                      disabled={isSaving || !editedContent.trim()}
                      className="h-7 rounded-none"
                    >
                      {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
                      Save
                    </Button>
                  </div>
                )}

                {/* Scrollable Content Area */}
                <div
                  style={{
                    maxHeight: '300px',
                    overflowY: 'auto',
                    overscrollBehavior: 'contain'
                  }}
                >
                  <Textarea
                    value={editedContent}
                    onChange={handleContentChange}
                    className="min-h-[150px] bg-transparent border-0 rounded-none resize-none text-sm leading-relaxed p-4 focus-visible:ring-0 focus-visible:ring-offset-0"
                    disabled={isSaving}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Input + Send */}
        <div className="px-6 py-4 border-t border-zinc-800">
          <div className="flex gap-3">
            <Textarea
              ref={textareaRef}
              value={modificationPrompt}
              onChange={(e) => setModificationPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask for changes (e.g., 'Make it shorter', 'Use more formal tone')..."
              className="min-h-[60px] bg-transparent border-zinc-800 rounded-none resize-none text-sm focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isSending || isSaving}
            />
            <Button
              onClick={handleSendModification}
              disabled={!modificationPrompt.trim() || isSending || isSaving}
              className="h-[60px] w-[60px] rounded-none shrink-0 bg-emerald-600 hover:bg-emerald-500"
            >
              {isSending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowUp className="size-7" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-[10px] text-zinc-500">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
