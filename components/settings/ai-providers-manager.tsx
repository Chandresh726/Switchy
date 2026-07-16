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
  AlertDialogCancel,
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
import { isLocalCLIProvider } from "@/lib/ai/providers/types";
import type { ProviderSettingsListItem } from "@/lib/settings/types";
import { cn } from "@/lib/utils";

interface AIProvidersManagerProps {
  providers: ProviderSettingsListItem[];
  onAddProvider: (provider: string, apiKey?: string) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onUpdateProviderApiKey: (id: string, apiKey?: string) => Promise<void>;
  onRefreshProviderModels: (id: string) => Promise<void>;
  codexExecutablePath: string;
  openCodeExecutablePath: string;
  onSaveExecutablePaths: (paths: { codex: string; opencode: string }) => Promise<void>;
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
    return {
      label: provider.connectionStatus?.replaceAll("_", " ") ?? "checking",
      ready: provider.connectionStatus === "ready",
      message: provider.statusMessage ?? "Switchy is checking this CLI automatically.",
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
  onUpdateProviderApiKey,
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
  const [refreshingProviderIds, setRefreshingProviderIds] = useState<Record<string, boolean>>({});
  const [executablePaths, setExecutablePaths] = useState({
    codex: codexExecutablePath,
    opencode: openCodeExecutablePath,
  });
  const [savingPaths, setSavingPaths] = useState(false);

  const selectedMetadata = metadata.find((item) => item.id === selectedProviderType);
  const availableProviders = metadata.filter(
    (item) => !isLocalCLIProvider(item.id) &&
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
          setError(saveError instanceof Error ? saveError.message : "Failed to update executable path");
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
    setError(null);
  };

  const handleProviderSelection = (provider: string) => {
    setSelectedProviderType(provider);
    setApiKey("");
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
      await onAddProvider(selectedProviderType, apiKey.trim() || undefined);
      resetAddForm();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Failed to add provider");
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
      await onUpdateProviderApiKey(provider.id, editApiKey.trim());
      setEditingProviderId(null);
      setEditApiKey("");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update API key");
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
            Manage API-key and local CLI providers in one place.
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
                        <span className="font-medium">{providerMetadata?.displayName ?? provider.provider}</span>
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
                        aria-label={isCLI ? "Edit executable path" : "Edit API key"}
                        title={isCLI ? "Edit executable path" : "Edit API key"}
                        onClick={() => {
                          setEditingProviderId(isEditing ? null : provider.id);
                          setEditApiKey("");
                          setError(null);
                        }}
                      >
                        <Pencil />
                      </Button>
                      {!isCLI ? (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Delete provider" title="Delete provider">
                              <Trash2 className="text-muted-foreground hover:text-red-400" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {providerMetadata?.displayName ?? "provider"}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Its connection and cached model list will be removed. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => onDeleteProvider(provider.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : null}
                    </div>
                  </div>

                  {isEditing ? (
                    isCLI ? (
                      <FieldGroup>
                        <Field>
                          <FieldLabel htmlFor={`executable-${provider.id}`}>Executable path</FieldLabel>
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
                          <FieldDescription>Leave empty to use the executable from PATH.</FieldDescription>
                        </Field>
                      </FieldGroup>
                    ) : (
                      <FieldGroup>
                        <Field data-invalid={Boolean(error)}>
                          <FieldLabel htmlFor={`api-key-${provider.id}`}>Replacement API key</FieldLabel>
                          <InputGroup>
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
                          <FieldDescription>The stored key remains hidden and encrypted.</FieldDescription>
                          {error ? <FieldError>{error}</FieldError> : null}
                        </Field>
                        <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditingProviderId(null)}>Cancel</Button>
                          <Button size="sm" onClick={() => handleUpdateKey(provider)} disabled={updatingKey}>
                            {updatingKey ? <Loader2 className="animate-spin" data-icon="inline-start" /> : <Key data-icon="inline-start" />}
                            Update key
                          </Button>
                        </div>
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
                        {provider.displayName} · API key
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

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
