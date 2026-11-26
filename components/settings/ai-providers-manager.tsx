"use client";

import { useState } from "react";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAllProviderMetadata, type ProviderMetadata } from "@/lib/ai/providers/metadata";
import { CLI_EXECUTABLE_CONFIG } from "@/lib/ai/local-cli/constants";
import { isLocalCLIProvider } from "@/lib/ai/providers/types";
import type {
  ProviderCreateBody,
  ProviderPatchBody,
} from "@/lib/api/contracts/providers";
import type { ProviderSettingsListItem } from "@/lib/api/contracts/settings";
import { getApiErrorMessage } from "@/lib/api/error-presentation";
import { cn } from "@/lib/utils";

import { CustomProviderFields, EMPTY_CUSTOM_FORM, API_FORMAT_LABELS, parseManualModels, parseReasoningEfforts, createHeaderDraft, type CustomFormState } from "./custom-provider-fields";
import { CLIExecutableField } from "./cli-executable-field";

interface AIProvidersManagerProps {
  providers: ProviderSettingsListItem[];
  onAddProvider: (input: ProviderCreateBody) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onUpdateProvider: (id: string, input: ProviderPatchBody) => Promise<void>;
  onRefreshProviderModels: (id: string) => Promise<void>;
  codexExecutablePath: string;
  openCodeExecutablePath: string;
  onCheckConnection: (id: string) => Promise<void>;
  onSaveExecutablePaths: (paths: Partial<{ codex: string; opencode: string }>) => Promise<void>;
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
  if (provider.connectionStatus && provider.connectionStatus !== "ready") {
    return {
      label: provider.connectionStatus === "not_authenticated" ? "sign in required" : "needs attention",
      ready: false,
      message: provider.statusMessage ?? "Check the connection and try again.",
    };
  }
  const verified = provider.connectionStatus === "ready" && !provider.statusIsStale && provider.modelDiscovery !== "manual";
  return {
    label: verified ? "verified" : "configured",
    ready: verified,
    message: provider.statusMessage ?? (provider.kind === "local_cli"
      ? "Uses the login saved by your CLI. Availability is checked separately."
      : provider.kind === "custom"
        ? `${provider.apiFormat ? API_FORMAT_LABELS[provider.apiFormat] : "Custom API"} · ${provider.baseUrl ?? "Configured endpoint"}`
        : provider.hasApiKey ? "API key saved. Check connection to verify access." : "Add an API key to use this provider"),
  };
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
  onCheckConnection,
}: AIProvidersManagerProps) {
  const metadata = getAllProviderMetadata();
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pathPending, setPathPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [updatingKey, setUpdatingKey] = useState(false);
  const [customForm, setCustomForm] = useState<CustomFormState>(EMPTY_CUSTOM_FORM);
  const [editCustomForm, setEditCustomForm] = useState<CustomFormState | null>(null);
  const [refreshingProviderIds, setRefreshingProviderIds] = useState<Record<string, boolean>>({});
  const [checkingProviderIds, setCheckingProviderIds] = useState<Record<string, boolean>>({});

  const selectedMetadata = metadata.find((item) => item.id === selectedProviderType);
  const availableProviders = metadata.filter(
    (item) => item.id === "custom" ||
      !providers.some((provider) => provider.provider === item.id)
  );

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
          modelDiscovery: customForm.modelDiscovery,
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
          modelDiscovery: provider.modelDiscovery ?? "auto",
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
        modelDiscovery: editCustomForm.modelDiscovery,
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
              const isChecking = Boolean(provider.checking || checkingProviderIds[provider.id]);
              const isEditing = editingProviderId === provider.id;
              const refreshing = Boolean(refreshingProviderIds[provider.id]);
              const canRefresh = true;
              const pathKey = provider.provider === "codex_cli" ? "codex" : "opencode";
              const providerName = provider.displayName ?? providerMetadata?.displayName ?? provider.provider;

              return (
                <div key={provider.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background/30 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {isCLI ? <Terminal className="size-4 text-emerald-500" /> : null}
                        <span className="font-medium">{providerName}</span>
                        {provider.cliVersion ? <span className="text-muted-foreground">v{provider.cliVersion}</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{status.message}</p>
                      {provider.lastCheckedAt ? <p className="mt-1 text-xs text-muted-foreground">Last checked {new Date(provider.lastCheckedAt).toLocaleString()}{provider.statusIsStale ? " · saved status" : ""}</p> : null}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("text-xs capitalize", providerStatusClass(provider, status.ready))}>
                        {isChecking ? <Loader2 className="animate-spin" data-icon="inline-start" /> : status.ready ? <Check data-icon="inline-start" /> : null}
                        {status.label}
                      </Badge>
                      <Button variant="outline" size="sm" disabled={isChecking} onClick={async () => {
                        setCheckingProviderIds((current) => ({ ...current, [provider.id]: true }));
                        try { await onCheckConnection(provider.id); }
                        finally { setCheckingProviderIds((current) => ({ ...current, [provider.id]: false })); }
                      }}>Check connection</Button>
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
                                Its saved connection will be removed. Features using it will switch to an available provider and model, or require setup if none is available. Any matching fallbacks using it will be disabled.
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
                      <CLIExecutableField
                        id={`executable-${provider.id}`}
                        value={pathKey === "codex" ? codexExecutablePath : openCodeExecutablePath}
                        command={pathKey === "codex" ? "codex" : "opencode"}
                        onSave={(value) => onSaveExecutablePaths({ [pathKey]: value })}
                      />
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

            {selectedMetadata && isLocalCLIProvider(selectedMetadata.id) ? (
              <div className="grid gap-3">
                <p className="text-xs text-muted-foreground">Install {CLI_EXECUTABLE_CONFIG[selectedMetadata.id].command}, then run <code>{CLI_EXECUTABLE_CONFIG[selectedMetadata.id].setupCommand}</code> in your terminal. Switchy reuses that login and verifies usable models before adding the provider.</p>
                <CLIExecutableField
                  key={selectedMetadata.id}
                  id="new-cli-executable"
                  onPendingChange={setPathPending}
                  value={selectedMetadata.id === "codex_cli" ? codexExecutablePath : openCodeExecutablePath}
                  command={CLI_EXECUTABLE_CONFIG[selectedMetadata.id].command}
                  onSave={(value) => onSaveExecutablePaths(selectedMetadata.id === "codex_cli" ? { codex: value } : { opencode: value })}
                />
              </div>
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
                disabled={adding || pathPending || !selectedProviderType}
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
