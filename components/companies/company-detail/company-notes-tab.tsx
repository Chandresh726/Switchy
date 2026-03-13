"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useDebounce } from "@/lib/hooks/use-debounce";
import { companyKeys } from "@/lib/query-keys";

import type { CompanyOverviewResponse } from "./types";
import { useCompanyNotesContext } from "./company-notes-context";

interface CompanyNotesTabProps {
  companyId: number;
  note: string | null;
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function linkifyText(text: string): string {
  return escapeHtml(text).replace(URL_PATTERN, (match) => {
    const safeUrl = escapeHtml(match);

    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" contenteditable="false" class="company-note-link">${safeUrl}</a>`;
  });
}

function textToHtml(text: string): string {
  if (!text) {
    return "";
  }

  return linkifyText(text).replace(/\n/g, "<br>");
}

function getCaretOffset(root: HTMLElement): number {
  const selection = window.getSelection();

  if (!selection || selection.rangeCount === 0) {
    return 0;
  }

  const range = selection.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(root);
  preCaretRange.setEnd(range.endContainer, range.endOffset);

  return preCaretRange.toString().length;
}

function setCaretOffset(root: HTMLElement, offset: number) {
  const selection = window.getSelection();

  if (!selection) {
    return;
  }

  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textLength = currentNode.textContent?.length ?? 0;

    if (remaining <= textLength) {
      range.setStart(currentNode, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    remaining -= textLength;
    currentNode = walker.nextNode();
  }

  range.selectNodeContents(root);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

export function CompanyNotesTab({ companyId, note }: CompanyNotesTabProps) {
  const queryClient = useQueryClient();
  const { setNoteSaveIndicator } = useCompanyNotesContext();
  const initialNote = note ?? "";
  const [draft, setDraft] = useState(initialNote);
  const [lastSavedDraft, setLastSavedDraft] = useState(initialNote);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const pendingCaretOffsetRef = useRef<number | null>(null);
  const hideIndicatorTimeoutRef = useRef<number | null>(null);

  const debouncedDraft = useDebounce(draft, 500);
  const editorHtml = useMemo(() => textToHtml(draft), [draft]);

  const saveMutation = useMutation({
    mutationFn: async (nextNote: string) => {
      const res = await fetch(`/api/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: nextNote }),
      });

      if (!res.ok) {
        throw new Error("Failed to save company notes");
      }

      return res.json();
    },
    onMutate: () => {
      if (hideIndicatorTimeoutRef.current) {
        window.clearTimeout(hideIndicatorTimeoutRef.current);
        hideIndicatorTimeoutRef.current = null;
      }
      setNoteSaveIndicator("saving");
    },
    onSuccess: (updatedCompany, savedNote) => {
      setLastSavedDraft(savedNote);
      setNoteSaveIndicator("saved");
      queryClient.setQueryData<CompanyOverviewResponse | undefined>(
        companyKeys.overview(companyId),
        (current) =>
          current
            ? {
                ...current,
                company: {
                  ...current.company,
                  notes: updatedCompany.notes,
                },
              }
            : current
      );
      queryClient.invalidateQueries({ queryKey: companyKeys.list() });
      hideIndicatorTimeoutRef.current = window.setTimeout(() => {
        setNoteSaveIndicator("hidden");
        hideIndicatorTimeoutRef.current = null;
      }, 1200);
    },
    onError: (error) => {
      setNoteSaveIndicator("hidden");
      toast.error(error instanceof Error ? error.message : "Failed to save company notes");
    },
  });

  useEffect(() => {
    setNoteSaveIndicator("hidden");

    return () => {
      if (hideIndicatorTimeoutRef.current) {
        window.clearTimeout(hideIndicatorTimeoutRef.current);
      }
      setNoteSaveIndicator("hidden");
    };
  }, [setNoteSaveIndicator]);

  useEffect(() => {
    if (debouncedDraft === lastSavedDraft || saveMutation.isPending) {
      return;
    }

    saveMutation.mutate(debouncedDraft);
  }, [debouncedDraft, lastSavedDraft, saveMutation, saveMutation.isPending]);

  useLayoutEffect(() => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    if (editor.innerHTML !== editorHtml) {
      editor.innerHTML = editorHtml;
    }

    if (pendingCaretOffsetRef.current !== null && document.activeElement === editor) {
      setCaretOffset(editor, pendingCaretOffsetRef.current);
      pendingCaretOffsetRef.current = null;
    }
  }, [editorHtml]);

  const syncDraftFromEditor = () => {
    const editor = editorRef.current;

    if (!editor) {
      return;
    }

    pendingCaretOffsetRef.current = getCaretOffset(editor);
    setDraft(editor.innerText.replace(/\u00A0/g, " "));
  };

  const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    const anchor = target.closest("a");
    if (anchor instanceof HTMLAnchorElement) {
      event.preventDefault();
      window.open(anchor.href, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="h-[calc(100vh-18.5rem)] overflow-hidden rounded-xl border border-border bg-card/30">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        role="textbox"
        aria-multiline="true"
        data-placeholder="Write anything useful about this company..."
        onInput={syncDraftFromEditor}
        onClick={handleEditorClick}
        className="company-note-editor box-border h-full overflow-y-auto px-3 py-3 text-sm leading-6 text-foreground outline-none"
      />
    </div>
  );
}
