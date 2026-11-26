"use client";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomAPIFormat } from "@/lib/ai/providers/types";

interface HeaderDraft {
  id: string;
  name: string;
  value: string;
  configured?: boolean;
}

export interface CustomFormState {
  displayName: string;
  apiFormat: CustomAPIFormat;
  baseUrl: string;
  apiKey: string;
  removeApiKey: boolean;
  headers: HeaderDraft[];
  modelDiscovery: "auto" | "manual";
  manualModels: string;
  reasoningEfforts: string;
}

export const EMPTY_CUSTOM_FORM: CustomFormState = {
  displayName: "",
  apiFormat: "openai_chat_completions",
  baseUrl: "",
  apiKey: "",
  removeApiKey: false,
  headers: [],
  modelDiscovery: "auto",
  manualModels: "",
  reasoningEfforts: "",
};

export const API_FORMAT_LABELS: Record<CustomAPIFormat, string> = {
  openai_chat_completions: "OpenAI Chat Completions",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic Messages",
};

export function parseManualModels(value: string): string[] {
  return value.split(/[\n,]/).map((model) => model.trim()).filter(Boolean);
}

export function parseReasoningEfforts(value: string): string[] {
  return value.split(/[\n,]/).map((effort) => effort.trim()).filter(Boolean);
}

export function createHeaderDraft(input: Omit<HeaderDraft, "id">): HeaderDraft {
  return { id: crypto.randomUUID(), ...input };
}

interface CustomProviderFieldsProps {
  value: CustomFormState;
  onChange: (value: CustomFormState) => void;
  editing?: boolean;
}

export function CustomProviderFields({ value, onChange, editing = false }: CustomProviderFieldsProps) {
  const update = <K extends keyof CustomFormState>(key: K, next: CustomFormState[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-custom-name" : "custom-name"}>Name</Label>
        <Input
          id={editing ? "edit-custom-name" : "custom-name"}
          value={value.displayName}
          onChange={(event) => update("displayName", event.target.value)}
          placeholder="CLI Proxy API"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-custom-format" : "custom-format"}>API format</Label>
        <Select
          value={value.apiFormat}
          onValueChange={(apiFormat) => update("apiFormat", apiFormat as CustomAPIFormat)}
        >
          <SelectTrigger id={editing ? "edit-custom-format" : "custom-format"} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(API_FORMAT_LABELS).map(([format, label]) => (
              <SelectItem key={format} value={format}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-custom-url" : "custom-url"}>Base URL</Label>
        <Input
          id={editing ? "edit-custom-url" : "custom-url"}
          value={value.baseUrl}
          onChange={(event) => update("baseUrl", event.target.value)}
          placeholder="http://127.0.0.1:8317/v1"
        />
        <p className="text-xs text-muted-foreground">Switchy appends /models and the selected API route.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-custom-api-key" : "custom-api-key"}>API key or token (optional)</Label>
        <Input
          id={editing ? "edit-custom-api-key" : "custom-api-key"}
          type="password"
          value={value.apiKey}
          onChange={(event) => update("apiKey", event.target.value)}
          placeholder={editing ? "Leave blank to keep the stored credential" : "Uses the format's standard auth header"}
          disabled={value.removeApiKey}
        />
        {editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => update("removeApiKey", !value.removeApiKey)}
          >
            {value.removeApiKey ? "Keep stored credential" : "Remove stored credential"}
          </Button>
        ) : null}
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>Custom headers</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => update("headers", [
              ...value.headers,
              createHeaderDraft({ name: "", value: "" }),
            ])}
          >
            <Plus data-icon="inline-start" />
            Add header
          </Button>
        </div>
        {value.headers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No additional headers.</p>
        ) : (
          <div className="grid gap-2">
            {value.headers.map((header, index) => (
              <div key={header.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <Input
                  aria-label={`Header ${index + 1} name`}
                  value={header.name}
                  onChange={(event) => update("headers", value.headers.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: event.target.value } : item
                  ))}
                  placeholder="Header name"
                />
                <Input
                  aria-label={`Header ${index + 1} value`}
                  type="password"
                  value={header.value}
                  onChange={(event) => update("headers", value.headers.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value: event.target.value } : item
                  ))}
                  placeholder={header.configured ? "Stored value" : "Header value"}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove header ${index + 1}`}
                  onClick={() => update("headers", value.headers.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-model-discovery" : "model-discovery"}>Model discovery</Label>
        <Select value={value.modelDiscovery} onValueChange={(mode) => update("modelDiscovery", mode as "auto" | "manual")}>
          <SelectTrigger id={editing ? "edit-model-discovery" : "model-discovery"}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Discover models automatically</SelectItem>
            <SelectItem value="manual">Use manual model IDs only</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-custom-models" : "custom-models"}>Manual model IDs (optional)</Label>
        <Textarea
          id={editing ? "edit-custom-models" : "custom-models"}
          value={value.manualModels}
          onChange={(event) => update("manualModels", event.target.value)}
          placeholder="One model ID per line"
        />
        <p className="text-xs text-muted-foreground">{value.modelDiscovery === "manual" ? "Enter at least one model ID. Switchy will skip /models; inference verifies access." : "Manual IDs are merged with models returned by /models."}</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={editing ? "edit-custom-reasoning" : "custom-reasoning"}>Reasoning levels (optional)</Label>
        <Input
          id={editing ? "edit-custom-reasoning" : "custom-reasoning"}
          value={value.reasoningEfforts}
          onChange={(event) => update("reasoningEfforts", event.target.value)}
          placeholder="low, medium, high"
        />
        <p className="text-xs text-muted-foreground">
          Enables reasoning selectors for every model from this provider. Add xhigh or max only when those models accept it.
        </p>
      </div>
    </div>
  );
}
