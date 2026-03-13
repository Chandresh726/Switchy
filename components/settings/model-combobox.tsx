"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ProviderModelOption } from "@/lib/types";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxTrigger,
} from "@/components/ui/combobox";

function DescriptionMarquee({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const check = () => setOverflows(el.scrollWidth > el.clientWidth);
    check();

    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  return (
    <div ref={containerRef} className="overflow-hidden min-w-0">
      <div
        className={`whitespace-nowrap ${
          overflows
            ? "flex w-fit gap-[3em] group-data-highlighted/model-item:[animation:marquee-scroll_40s_linear_1s_infinite]"
            : ""
        }`}
      >
        <span className="text-xs text-muted-foreground shrink-0">
          {text}
        </span>
        {overflows && (
          <span
            className="text-xs text-muted-foreground shrink-0"
            aria-hidden="true"
          >
            {text}
          </span>
        )}
      </div>
    </div>
  );
}

interface ModelComboboxProps {
  models: ProviderModelOption[];
  value: string;
  onValueChange: (modelId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  error?: string;
}

export function ModelCombobox({
  models,
  value,
  onValueChange,
  disabled = false,
  loading = false,
  placeholder = "Select model",
  emptyMessage = "No models available",
  error,
}: ModelComboboxProps) {
  const [search, setSearch] = useState("");
  const anchorRef = useRef<HTMLDivElement | null>(null);

  const modelMap = useMemo(() => {
    const map = new Map<string, ProviderModelOption>();
    for (const m of models) map.set(m.modelId, m);
    return map;
  }, [models]);

  const selectedModel = modelMap.get(value);

  const filteredModels = useMemo(() => {
    if (!search) return models;
    const q = search.toLowerCase();
    return models.filter(
      (m) =>
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.modelId.toLowerCase().includes(q),
    );
  }, [models, search]);

  const itemToStringLabel = useCallback(
    (itemValue: string) => modelMap.get(itemValue)?.label ?? itemValue,
    [modelMap],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center gap-2 rounded-none border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading models...
      </div>
    );
  }

  if (models.length === 0) {
    return (
      <div className="flex-1 flex items-center rounded-none border border-border bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        {error || emptyMessage}
      </div>
    );
  }

  return (
    <Combobox
      value={value}
      onValueChange={(val) => {
        if (val != null) onValueChange(val as string);
      }}
      inputValue={search}
      onInputValueChange={(val) => setSearch(val)}
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
      filter={null}
      itemToStringLabel={itemToStringLabel}
    >
      <div ref={anchorRef} className="flex-1">
        <ComboboxTrigger
          className="border-input dark:bg-input/30 dark:hover:bg-input/50 w-full h-8 rounded-none border bg-transparent px-2.5 py-2 text-xs flex items-center justify-between whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
        >
          <span className={`truncate text-left ${selectedModel ? "" : "text-muted-foreground"}`}>
            {selectedModel?.label ?? placeholder}
          </span>
        </ComboboxTrigger>
      </div>
      <ComboboxContent anchor={anchorRef}>
        {models.length > 10 && (
          <ComboboxInput
            showTrigger={false}
            placeholder="Search models..."
          />
        )}
        <ComboboxList>
          {filteredModels.map((model) => (
            <ComboboxItem
              key={model.modelId}
              value={model.modelId}
              showIndicator={false}
              className="group/model-item"
            >
              <div className="flex items-center min-w-0 flex-1">
                <span className="font-medium shrink-0 whitespace-nowrap">
                  {model.label}
                </span>
                {model.description && (
                  <>
                    <span className="text-muted-foreground text-xs shrink-0 px-1.5">
                      •
                    </span>
                    <DescriptionMarquee text={model.description} />
                  </>
                )}
              </div>
            </ComboboxItem>
          ))}
          {filteredModels.length === 0 && (
            <div className="text-muted-foreground py-6 text-center text-xs">
              No models found
            </div>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
