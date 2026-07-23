"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAllProviderMetadata, type ProviderMetadata } from "@/lib/ai/providers/metadata";
import type { CustomAPIFormat } from "@/lib/ai/providers/types";
import type {
  ProviderCreateBody,
  ProviderPatchBody,
} from "@/lib/api/contracts/providers";
import type { ProviderSettingsListItem } from "@/lib/api/contracts/settings";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cn } from "@/lib/utils";

interface AIProvidersManagerProps {
  providers: ProviderSettingsListItem[];
  onAddProvider: (input: ProviderCreateBody) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onUpdateProvider: (id: string, input: ProviderPatchBody) => Promise<void>;
  onRefreshProviderModels: (id: string) => Promise<void>;
  codexExecutablePath: string;
  openCodeExecutablePath: string;
  onSaveExecutablePaths: (paths: { codex: string; opencode: string }) => Promise<void>;
}

interface HeaderDraft {
  id: string;
  name: string;
  value: string;
  configured?: boolean;
}

interface CustomFormState {
  displayName: string;
  apiFormat: CustomAPIFormat;
  baseUrl: string;
  apiKey: string;
  removeApiKey: boolean;
  headers: HeaderDraft[];
  manualModels: string;
  reasoningEfforts: string;
}

const EMPTY_CUSTOM_FORM: CustomFormState = {
  displayName: "",
  apiFormat: "openai_chat_completions",
  baseUrl: "",
  apiKey: "",
  removeApiKey: false,
  headers: [],
  manualModels: "",
  reasoningEfforts: "",
};

const API_FORMAT_LABELS: Record<CustomAPIFormat, string> = {
  openai_chat_completions: "OpenAI Chat Completions",
  openai_responses: "OpenAI Responses",
  anthropic_messages: "Anthropic Messages",
};

function parseManualModels(value: string): string[] {
  return value.split(/[\n,]/).map((model) => model.trim()).filter(Boolean);
}

function parseReasoningEfforts(value: string): string[] {
  return value.split(/[\n,]/).map((effort) => effort.trim()).filter(Boolean);
}

function createHeaderDraft(input: Omit<HeaderDraft, "id">): HeaderDraft {
  return { id: crypto.randomUUID(), ...input };
}

interface CustomProviderFieldsProps {
  value: CustomFormState;
  onChange: (value: CustomFormState) => void;
  editing?: boolean;
}

function CustomProviderFields({ value, onChange, editing = false }: CustomProviderFieldsProps) {
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
        <Label htmlFor={editing ? "edit-custom-models" : "custom-models"}>Manual model IDs (optional)</Label>
        <Textarea
          id={editing ? "edit-custom-models" : "custom-models"}
          value={value.manualModels}
          onChange={(event) => update("manualModels", event.target.value)}
          placeholder="One model ID per line"
        />
        <p className="text-xs text-muted-foreground">Manual IDs are merged with models returned by /models.</p>
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

interface ProviderApiKeyHelpProps {
  metadata?: ProviderMetadata;
}

function ProviderApiKeyHelp({ metadata }: ProviderApiKeyHelpProps) {
  if (!metadata?.requiresApiKey || !metadata.apiKeyUrl) return null;

  return (
    <p className="text-xs text-muted-foreground">
      <a
        href={metadata.apiKeyUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-emerald-400 hover:underline"
      >
        Create an API key
      </a>
      {metadata.freeTierNote ? ` · ${metadata.freeTierNote}` : ""}
    </p>
  );
}

function providerStatusClass(provider: ProviderSettingsListItem, ready: boolean): string {
  if (ready) return "text-green-400";
  if (
    provider.kind === "local_cli" &&
    ["not_installed", "incompatible", "error"].includes(provider.connectionStatus ?? "")
  ) {
    return "text-red-400";
  }
  return "text-amber-400";
}

function providerStatus(provider: ProviderSettingsListItem): {
  label: string;
  ready: boolean;
  message: string;
} {
  if (provider.kind === "local_cli") {
    const isReady = provider.connectionStatus === "ready";
    return {
      label: isReady
        ? "connected"
        : provider.connectionStatus?.replaceAll("_", " ") ?? "checking",
      ready: isReady,
      message: provider.statusMessage ?? "Switchy is checking this CLI automatically.",
    };
  }

  if (provider.kind === "custom") {
    return {
      label: "connected",
      ready: true,
      message: `${provider.apiFormat ? API_FORMAT_LABELS[provider.apiFormat] : "Custom API"} · ${provider.baseUrl ?? "Configured endpoint"}`,
    };
  }

  return provider.hasApiKey
    ? { label: "connected", ready: true, message: "API key configured" }
    : { label: "needs key", ready: false, message: "Add an API key to use this provider" };
}

export function AIProvidersManager({
  providers,
  onAddProvider,
  onDeleteProvider,
  onUpdateProvider,
  onRefreshProviderModels,
  codexExecutablePath,
  openCodeExecutablePath,
  onSaveExecutablePaths,
}: AIProvidersManagerProps) {
  const metadata = getAllProviderMetadata();
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [updatingKey, setUpdatingKey] = useState(false);
  const [customForm, setCustomForm] = useState<CustomFormState>(EMPTY_CUSTOM_FORM);
  const [editCustomForm, setEditCustomForm] = useState<CustomFormState | null>(null);
  const [refreshingProviderIds, setRefreshingProviderIds] = useState<Record<string, boolean>>({});
  const [executablePaths, setExecutablePaths] = useState({
    codex: codexExecutablePath,
    opencode: openCodeExecutablePath,
  });
  const [savingPaths, setSavingPaths] = useState(false);

  const selectedMetadata = metadata.find((item) => item.id === selectedProviderType);
  const availableProviders = metadata.filter(
    (item) => item.id === "custom" ||
      !providers.some((provider) => provider.provider === item.id)
  );

  useEffect(() => {
    if (
      executablePaths.codex === codexExecutablePath &&
      executablePaths.opencode === openCodeExecutablePath
    ) {
      return;
    }

    const timer = setTimeout(() => {
      setSavingPaths(true);
      setError(null);
      void onSaveExecutablePaths(executablePaths)
        .catch((saveError: unknown) => {
          setError(getApiErrorMessage(saveError, "Failed to update executable path"));
        })
        .finally(() => setSavingPaths(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [
    codexExecutablePath,
    executablePaths,
    onSaveExecutablePaths,
    openCodeExecutablePath,
  ]);

  const resetAddForm = () => {
    setIsAddingProvider(false);
    setSelectedProviderType("");
    setApiKey("");
    setShowApiKey(false);
    setCustomForm(EMPTY_CUSTOM_FORM);
    setError(null);
  };

  const handleProviderSelection = (provider: string) => {
    setSelectedProviderType(provider);
    setApiKey("");
    setCustomForm(EMPTY_CUSTOM_FORM);
    setError(null);
  };

  const handleAddProvider = async () => {
    if (!selectedProviderType) {
      setError("Select a provider");
      return;
    }
    if (selectedMetadata?.requiresApiKey && !apiKey.trim()) {
      setError("API key is required");
      return;
    }

    setAdding(true);
    setError(null);
    try {
      if (selectedProviderType === "custom") {
        await onAddProvider({
          provider: "custom",
          displayName: customForm.displayName,
          apiFormat: customForm.apiFormat,
          baseUrl: customForm.baseUrl,
          apiKey: customForm.apiKey.trim() || undefined,
          headers: customForm.headers.map(({ name, value }) => ({ name, value })),
          manualModelIds: parseManualModels(customForm.manualModels),
          reasoningEfforts: parseReasoningEfforts(customForm.reasoningEfforts),
        });
      } else {
        await onAddProvider({
          provider: selectedProviderType,
          apiKey: apiKey.trim() || undefined,
        });
      }
      resetAddForm();
    } catch (addError) {
      setError(getApiErrorMessage(addError, "Failed to add provider"));
    } finally {
      setAdding(false);
    }
  };

  const handleUpdateKey = async (provider: ProviderSettingsListItem) => {
    if (!editApiKey.trim()) {
      setError("Enter a replacement API key");
      return;
    }
    setUpdatingKey(true);
    setError(null);
    try {
      await onUpdateProvider(provider.id, { apiKey: editApiKey.trim() });
      setEditingProviderId(null);
      setEditApiKey("");
    } catch (updateError) {
      setError(getApiErrorMessage(updateError, "Failed to update API key"));
    } finally {
      setUpdatingKey(false);
    }
  };

  const beginEditing = (provider: ProviderSettingsListItem) => {
    setEditingProviderId(editingProviderId === provider.id ? null : provider.id);
    setEditApiKey("");
    setEditCustomForm(provider.kind === "custom"
      ? {
          displayName: provider.displayName ?? "",
          apiFormat: provider.apiFormat ?? "openai_chat_completions",
          baseUrl: provider.baseUrl ?? "",
          apiKey: "",
          removeApiKey: false,
          headers: (provider.headerNames ?? []).map((name) => createHeaderDraft({
            name,
            value: "",
            configured: true,
          })),
          manualModels: (provider.manualModelIds ?? []).join("\n"),
          reasoningEfforts: (provider.reasoningEfforts ?? []).join(", "),
        }
      : null);
    setError(null);
  };

  const handleUpdateCustom = async (provider: ProviderSettingsListItem) => {
    if (!editCustomForm) return;
    setUpdatingKey(true);
    setError(null);
    try {
      await onUpdateProvider(provider.id, {
        displayName: editCustomForm.displayName,
        apiFormat: editCustomForm.apiFormat,
        baseUrl: editCustomForm.baseUrl,
        apiKey: editCustomForm.removeApiKey
          ? null
          : editCustomForm.apiKey.trim() || undefined,
        headers: editCustomForm.headers.map(({ name, value, configured }) => ({
          name,
          ...(value.length > 0 || !configured ? { value } : {}),
        })),
        manualModelIds: parseManualModels(editCustomForm.manualModels),
        reasoningEfforts: parseReasoningEfforts(editCustomForm.reasoningEfforts),
      });
      setEditingProviderId(null);
      setEditCustomForm(null);
    } catch (updateError) {
      setError(getApiErrorMessage(updateError, "Failed to update custom provider"));
    } finally {
      setUpdatingKey(false);
    }
  };

  const handleRefreshModels = async (providerId: string) => {
    setRefreshingProviderIds((current) => ({ ...current, [providerId]: true }));
    try {
      await onRefreshProviderModels(providerId);
    } finally {
      setRefreshingProviderIds((current) => ({ ...current, [providerId]: false }));
    }
  };

  return (
    <Card className="rounded-xl border-border bg-card/70">
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <Key className="text-blue-500" data-icon="inline-start" />
            AI Providers
          </CardTitle>
          <CardDescription>
            Manage API-key, custom API, and local CLI providers in one place.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {providers.length === 0 && !isAddingProvider ? (
          <div className="rounded-lg border border-dashed border-border bg-background/20 px-4 py-8 text-center text-muted-foreground">
            No AI providers configured yet.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {providers.map((provider) => {
              const providerMetadata = metadata.find((item) => item.id === provider.provider);
              const status = providerStatus(provider);
              const isCLI = provider.kind === "local_cli";
              const isEditing = editingProviderId === provider.id;
              const refreshing = Boolean(refreshingProviderIds[provider.id]);
              const canRefresh = status.ready;
              const pathKey = provider.provider === "codex_cli" ? "codex" : "opencode";

              return (
                <div key={provider.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background/30 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {isCLI ? <Terminal className="size-4 text-emerald-500" /> : null}
                        <span className="font-medium">{provider.displayName ?? providerMetadata?.displayName ?? provider.provider}</span>
                        {provider.cliVersion ? <span className="text-muted-foreground">v{provider.cliVersion}</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{status.message}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-xs capitalize", providerStatusClass(provider, status.ready))}
                      >
                        {status.ready ? <Check data-icon="inline-start" /> : <X data-icon="inline-start" />}
                        {status.label}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRefreshModels(provider.id)}
                        disabled={!canRefresh || refreshing}
                        aria-label="Refresh models"
                        title="Refresh models"
                      >
                        <RefreshCw className={cn("text-muted-foreground hover:text-foreground", refreshing && "animate-spin")} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={isEditing ? "Close editor" : isCLI ? "Edit executable path" : provider.kind === "custom" ? "Edit connection" : "Edit API key"}
                        title={isEditing ? "Close editor" : isCLI ? "Edit executable path" : provider.kind === "custom" ? "Edit connection" : "Edit API key"}
                        onClick={() => beginEditing(provider)}
                      >
                        {isEditing ? <X /> : <Pencil />}
                      </Button>
                      <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Delete provider" title="Delete provider">
                              <Trash2 className="text-muted-foreground hover:text-red-400" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent showCloseButton>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {provider.displayName ?? providerMetadata?.displayName ?? "provider"}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Its connection and cached model list will be removed. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogAction className="w-full" variant="destructive" onClick={() => onDeleteProvider(provider.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                    </div>
                  </div>

                  {isEditing ? (
                    isCLI ? (
                      <FieldGroup>
                        <Field>
                          <div className="flex items-baseline justify-between gap-3">
                            <FieldLabel htmlFor={`executable-${provider.id}`}>Executable path</FieldLabel>
                            <FieldDescription className="mt-0">Leave empty to use the executable from PATH.</FieldDescription>
                          </div>
                          <InputGroup>
                            <InputGroupInput
                              id={`executable-${provider.id}`}
                              value={executablePaths[pathKey]}
                              onChange={(event) => setExecutablePaths((current) => ({
                                ...current,
                                [pathKey]: event.target.value,
                              }))}
                              placeholder={provider.provider === "codex_cli" ? "Use codex from PATH" : "Use opencode from PATH"}
                            />
                            {savingPaths ? (
                              <InputGroupAddon align="inline-end">
                                <Loader2 className="animate-spin" />
                                Saving
                              </InputGroupAddon>
                            ) : null}
                          </InputGroup>
                        </Field>
                      </FieldGroup>
                    ) : provider.kind === "custom" && editCustomForm ? (
                      <FieldGroup>
                        <CustomProviderFields
                          value={editCustomForm}
                          onChange={setEditCustomForm}
                          editing
                        />
                        {error ? <FieldError>{error}</FieldError> : null}
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingProviderId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => handleUpdateCustom(provider)} disabled={updatingKey}>
                            {updatingKey ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                            Update connection
                          </Button>
                        </div>
                      </FieldGroup>
                    ) : (
                      <FieldGroup>
                        <Field data-invalid={Boolean(error)}>
                          <div className="flex items-baseline justify-between gap-3">
                            <FieldLabel htmlFor={`api-key-${provider.id}`}>Replacement API key</FieldLabel>
                            <FieldDescription className="mt-0">The stored key remains hidden and encrypted.</FieldDescription>
                          </div>
                          <div className="flex items-center gap-2">
                            <InputGroup className="flex-1">
                              <InputGroupAddon><Key /></InputGroupAddon>
                              <InputGroupInput
                                id={`api-key-${provider.id}`}
                                type="password"
                                value={editApiKey}
                                onChange={(event) => setEditApiKey(event.target.value)}
                                placeholder="Enter a new key"
                                aria-invalid={Boolean(error)}
                              />
                            </InputGroup>
                            <Button
                              onClick={() => handleUpdateKey(provider)}
                              disabled={updatingKey || !editApiKey.trim()}
                            >
                              {updatingKey ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                              Update
                            </Button>
                          </div>
                          {error ? <FieldError>{error}</FieldError> : null}
                        </Field>
                      </FieldGroup>
                    )
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {isAddingProvider ? (
          <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/70 p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-provider">Provider</Label>
              <Select value={selectedProviderType} onValueChange={handleProviderSelection}>
                <SelectTrigger id="new-provider" className="w-full border-border bg-background/60">
                  <SelectValue placeholder="Select a provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {availableProviders.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.displayName} · {provider.kind === "custom"
                          ? "API endpoint"
                          : provider.kind === "local_cli" ? "Local CLI" : "API key"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {selectedProviderType === "custom" ? (
              <CustomProviderFields value={customForm} onChange={setCustomForm} />
            ) : null}

            {selectedMetadata?.kind === "local_cli" ? (
              <p className="text-xs text-muted-foreground">
                Switchy will verify that the CLI is installed, authenticated, and exposes usable models before adding it.
              </p>
            ) : null}

            {selectedMetadata?.requiresApiKey ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-provider-api-key">API Key</Label>
                <div className="relative">
                  <Key className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-provider-api-key"
                    type={showApiKey ? "text" : "password"}
                    placeholder="Enter API key"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    className="w-full border-border bg-background/60 pl-9 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showApiKey ? "Hide API key" : "Show API key"}
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <ProviderApiKeyHelp metadata={selectedMetadata} />
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetAddForm} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleAddProvider}
                disabled={adding || !selectedProviderType}
                className="flex-1 bg-emerald-600 text-foreground hover:bg-emerald-500"
              >
                {adding ? <Loader2 className="animate-spin" data-icon="inline-start" /> : null}
                Add Provider
              </Button>
            </div>
          </div>
        ) : availableProviders.length > 0 ? (
          <Button
            variant="outline"
            className="w-full border-dashed border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 hover:text-emerald-300"
            onClick={() => setIsAddingProvider(true)}
          >
            <Plus data-icon="inline-start" />
            {providers.length === 0 ? "Add Provider" : "Add Another Provider"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
