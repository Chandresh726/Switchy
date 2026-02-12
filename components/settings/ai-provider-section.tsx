"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, Globe, Key } from "lucide-react";
import { GeminiStatusDisplay } from "./gemini-status";
import { AIProvider } from "./constants";
import { useState } from "react";

interface AIProviderSectionProps {
  aiProvider: AIProvider;
  onAiProviderChange: (value: string) => void;
  anthropicApiKey: string;
  onAnthropicApiKeyChange: (value: string) => void;
  onAnthropicApiKeyBlur?: () => void;
  googleApiKey: string;
  onGoogleApiKeyChange: (value: string) => void;
  onGoogleApiKeyBlur?: () => void;
  openaiApiKey: string;
  onOpenaiApiKeyChange: (value: string) => void;
  onOpenaiApiKeyBlur?: () => void;
  openrouterApiKey: string;
  onOpenrouterApiKeyChange: (value: string) => void;
  onOpenrouterApiKeyBlur?: () => void;
  cerebrasApiKey: string;
  onCerebrasApiKeyChange: (value: string) => void;
  onCerebrasApiKeyBlur?: () => void;
  modalApiKey: string;
  onModalApiKeyChange: (value: string) => void;
  onModalApiKeyBlur?: () => void;
}

export function AIProviderSection({
  aiProvider,
  onAiProviderChange,
  anthropicApiKey,
  onAnthropicApiKeyChange,
  onAnthropicApiKeyBlur,
  googleApiKey,
  onGoogleApiKeyChange,
  onGoogleApiKeyBlur,
  openaiApiKey,
  onOpenaiApiKeyChange,
  onOpenaiApiKeyBlur,
  openrouterApiKey,
  onOpenrouterApiKeyChange,
  onOpenrouterApiKeyBlur,
  cerebrasApiKey,
  onCerebrasApiKeyChange,
  onCerebrasApiKeyBlur,
  modalApiKey,
  onModalApiKeyChange,
  onModalApiKeyBlur,
}: AIProviderSectionProps) {
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  const renderKeyInput = (
    id: string,
    label: string,
    placeholder: string,
    value: string,
    onChange: (value: string) => void,
    onBlur?: () => void
  ) => {
    const isVisible = !!visibleKeys[id];

    return (
      <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="relative">
          <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input
            id={id}
            type={isVisible ? "text" : "password"}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            className="pl-9 pr-10 bg-zinc-950/50 border-zinc-800 font-mono"
          />
          <button
            type="button"
            aria-label={isVisible ? "Hide API key" : "Show API key"}
            onClick={() => setVisibleKeys((prev) => ({ ...prev, [id]: !prev[id] }))}
            className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-zinc-500 hover:text-zinc-300"
          >
            {isVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-500" />
          <CardTitle>AI Provider</CardTitle>
        </div>
        <CardDescription>
          Choose which AI service to use for job matching
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label>Provider</Label>
          <Select value={aiProvider} onValueChange={onAiProviderChange}>
            <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
              <SelectValue placeholder="Select provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="gemini_api_key">Gemini (API Key)</SelectItem>
              <SelectItem value="gemini_cli_oauth">Gemini (CLI OAuth)</SelectItem>
              <SelectItem value="openrouter">OpenRouter</SelectItem>
              <SelectItem value="cerebras">Cerebras</SelectItem>
              <SelectItem value="modal">Modal (GLM-5)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {aiProvider === "anthropic" && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            {renderKeyInput(
              "anthropic-key",
              "Anthropic API Key",
              "sk-ant-...",
              anthropicApiKey,
              onAnthropicApiKeyChange,
              onAnthropicApiKeyBlur
            )}
            <p className="text-xs text-zinc-500">
              Required for Claude models. Your key is stored locally.
            </p>
          </div>
        )}

        {aiProvider === "gemini_api_key" && (
          renderKeyInput(
            "gemini-key",
            "Gemini API Key",
            "AIza...",
            googleApiKey,
            onGoogleApiKeyChange,
            onGoogleApiKeyBlur
          )
        )}

        {aiProvider === "gemini_cli_oauth" && (
          <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
            <GeminiStatusDisplay />
          </div>
        )}

        {aiProvider === "openrouter" && (
          renderKeyInput(
            "openrouter-key",
            "OpenRouter API Key",
            "or-...",
            openrouterApiKey,
            onOpenrouterApiKeyChange,
            onOpenrouterApiKeyBlur
          )
        )}

        {aiProvider === "openai" && (
          renderKeyInput(
            "openai-key",
            "OpenAI API Key",
            "sk-...",
            openaiApiKey,
            onOpenaiApiKeyChange,
            onOpenaiApiKeyBlur
          )
        )}

        {aiProvider === "cerebras" && (
          renderKeyInput(
            "cerebras-key",
            "Cerebras API Key",
            "cbrs_...",
            cerebrasApiKey,
            onCerebrasApiKeyChange,
            onCerebrasApiKeyBlur
          )
        )}

        {aiProvider === "modal" && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
            {renderKeyInput(
              "modal-key",
              "Modal API Key",
              "Get key at modal.com/glm-5-endpoint",
              modalApiKey,
              onModalApiKeyChange,
              onModalApiKeyBlur
            )}
            <p className="text-xs text-zinc-500">
              Get your free API key at{" "}
              <a
                href="https://modal.com/glm-5-endpoint"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline"
              >
                modal.com/glm-5-endpoint
              </a>
              . Limited to 1 concurrent request.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
