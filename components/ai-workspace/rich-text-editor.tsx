"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { Bold, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { richHtmlToMarkdown, markdownToRichHtml } from "@/lib/ai/writing/rich-text";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
  minHeightClassName?: string;
}

function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function RichTextEditor({
  value,
  onChange,
  readOnly = false,
  disabled = false,
  className,
  minHeightClassName = "min-h-[220px]",
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastSyncedMarkdown = useRef("");

  useEffect(() => {
    if (!editorRef.current) return;
    if (value === lastSyncedMarkdown.current) return;

    editorRef.current.innerHTML = markdownToRichHtml(value);
    lastSyncedMarkdown.current = value;
  }, [value]);

  const emitChange = () => {
    if (!editorRef.current) return;
    const markdown = richHtmlToMarkdown(editorRef.current.innerHTML);
    lastSyncedMarkdown.current = markdown;
    onChange(markdown);
  };

  const handleBold = () => {
    if (readOnly || disabled) return;
    document.execCommand("bold");
    emitChange();
  };

  const handleLink = () => {
    if (readOnly || disabled) return;
    const input = window.prompt("Enter URL", "https://");
    if (!input) return;
    const href = normalizeUrl(input);
    if (!href) return;

    document.execCommand("createLink", false, href);
    emitChange();
  };

  const handleEditorClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest("a");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href) return;
    event.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const isLocked = readOnly || disabled;
  const showToolbar = !readOnly;

  return (
    <div className={cn("border border-border bg-background/30", className)}>
      {showToolbar ? (
        <div className="flex items-center gap-1 border-b border-border bg-background/60 px-2 py-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={handleBold}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onClick={handleLink}
            title="Insert link"
          >
            <Link2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : null}

      <div
        ref={editorRef}
        className={cn(
          "max-w-none px-4 py-3 text-sm leading-relaxed text-foreground focus:outline-none [&_p]:my-2 [&_strong]:font-semibold [&_a]:cursor-pointer [&_a]:text-blue-400 [&_a]:underline hover:[&_a]:text-blue-300",
          minHeightClassName,
          isLocked ? "cursor-default" : "cursor-text"
        )}
        contentEditable={!isLocked}
        suppressContentEditableWarning
        onInput={emitChange}
        onClick={handleEditorClick}
        aria-readonly={isLocked}
      />
    </div>
  );
}
