"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Key, Loader2, Trash2, Check, X, Pencil, Eye, EyeOff, Terminal } from "lucide-react";
import { getAllProviderMetadata, type ProviderMetadata } from "@/lib/ai/providers/metadata";
import type { ProviderWithDetails } from "@/lib/types";

interface GeminiStatus {
  installed: boolean;
  authenticated: boolean;
  message: string;
}

interface AIProvidersManagerProps {
  providers: ProviderWithDetails[];
  onAddProvider: (provider: string, apiKey?: string) => Promise<void>;
  onDeleteProvider: (id: string) => Promise<void>;
  onUpdateProviderApiKey: (id: string, apiKey?: string) => Promise<void>;
}

export function AIProvidersManager({
  providers,
  onAddProvider,
  onDeleteProvider,
  onUpdateProviderApiKey,
}: AIProvidersManagerProps) {
  const [isAddingProvider, setIsAddingProvider] = useState(false);
  const [selectedProviderType, setSelectedProviderType] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [editApiKey, setEditApiKey] = useState("");
  const [isEditLoading, setIsEditLoading] = useState(false);
  const [showEditApiKey, setShowEditApiKey] = useState(false);
  const [isFetchingApiKey, setIsFetchingApiKey] = useState(false);

  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus | null>(null);
  const [isCheckingGemini, setIsCheckingGemini] = useState(false);

  const providerMetadata = getAllProviderMetadata();

  const availableProviders = providerMetadata.filter(
    (p) => !providers.some((provider) => provider.provider === p.id)
  );

  const getProviderMeta = (providerType: string): ProviderMetadata | undefined => {
    return providerMetadata.find((p) => p.id === providerType);
  };

  const checkGeminiStatus = async () => {
    setIsCheckingGemini(true);
    try {
      const res = await fetch("/api/providers/gemini-cli-status");
      if (res.ok) {
        const data = await res.json();
        setGeminiStatus(data);
      }
    } catch (err) {
      console.error("Failed to check Gemini status:", err);
    } finally {
      setIsCheckingGemini(false);
    }
  };

  const hasGeminiCLI = providers.some(p => p.provider === "gemini_cli_oauth");

  useEffect(() => {
    if (hasGeminiCLI) {
      checkGeminiStatus();
    }
  }, [hasGeminiCLI]);

  useEffect(() => {
    if (selectedProviderType === "gemini_cli_oauth") {
      checkGeminiStatus();
    }
  }, [selectedProviderType]);

  const handleAddProvider = async () => {
    if (!selectedProviderType) {
      setError("Please select a provider");
      return;
    }

    const meta = getProviderMeta(selectedProviderType);
    if (meta?.requiresApiKey && !apiKey) {
      setError("API key is required for this provider");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onAddProvider(selectedProviderType, apiKey || undefined);
      setIsAddingProvider(false);
      setSelectedProviderType("");
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelAdd = () => {
    setIsAddingProvider(false);
    setSelectedProviderType("");
    setApiKey("");
    setError(null);
  };

  const handleEditProvider = async (provider: ProviderWithDetails) => {
    setIsEditLoading(true);

    try {
      const apiKeyToSave = editApiKey.trim() || undefined;
      await onUpdateProviderApiKey(provider.id, apiKeyToSave);
      setEditingProviderId(null);
      setEditApiKey("");
      setShowEditApiKey(false);
    } catch (err) {
      console.error("Failed to update provider:", err);
    } finally {
      setIsEditLoading(false);
    }
  };

  const startEditing = async (provider: ProviderWithDetails) => {
    setEditingProviderId(provider.id);
    setEditApiKey("");
    setShowEditApiKey(false);
    setIsFetchingApiKey(true);

    try {
      const res = await fetch(`/api/providers/${provider.id}/api-key`);
      if (res.ok) {
        const data = await res.json();
        setEditApiKey(data.apiKey || "");
      }
    } catch (err) {
      console.error("Failed to fetch API key:", err);
    } finally {
      setIsFetchingApiKey(false);
    }
  };

  const cancelEditing = () => {
    setEditingProviderId(null);
    setEditApiKey("");
    setShowEditApiKey(false);
  };

  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5 text-blue-500" />
              AI Providers
            </CardTitle>
            <CardDescription>
              Manage your AI provider connections. Each feature can use a different provider.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {providers.length === 0 && !isAddingProvider ? (
          <div className="text-center py-8 text-zinc-500">
            <p className="mb-4">No AI providers configured yet.</p>
            <Button onClick={() => setIsAddingProvider(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Provider
            </Button>
          </div>
        ) : (
          <>
            {providers.map((provider) => {
              const meta = getProviderMeta(provider.provider);
              const isEditing = editingProviderId === provider.id;
              const isGeminiCLI = provider.provider === "gemini_cli_oauth";

              return (
                <div
                  key={provider.id}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/30"
                >
                  {isEditing ? (
                    <div className="p-4 space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{meta?.displayName || provider.provider}</span>
                      </div>

                      {isGeminiCLI ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2 text-sm">
                            {isCheckingGemini ? (
                              <>
                                <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                                <span className="text-zinc-400">Checking Gemini CLI status...</span>
                              </>
                            ) : geminiStatus ? (
                              <>
                                {geminiStatus.authenticated ? (
                                  <Check className="h-4 w-4 text-green-400" />
                                ) : (
                                  <X className="h-4 w-4 text-amber-400" />
                                )}
                                <span className={geminiStatus.authenticated ? "text-green-400" : "text-amber-400"}>
                                  {geminiStatus.message}
                                </span>
                              </>
                            ) : null}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={checkGeminiStatus}
                            className="w-full"
                          >
                            <Terminal className="mr-2 h-4 w-4" />
                            Check Status
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label>API Key</Label>
                          <div className="relative">
                            <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                            <Input
                              type={showEditApiKey ? "text" : "password"}
                              placeholder={isFetchingApiKey ? "Loading..." : (provider.hasApiKey ? "••••••••••••" : "Enter API key")}
                              value={editApiKey}
                              onChange={(e) => setEditApiKey(e.target.value)}
                              disabled={isFetchingApiKey}
                              className="w-full pl-9 pr-10 bg-zinc-950/50 border-zinc-800"
                            />
                            <button
                              type="button"
                              onClick={() => setShowEditApiKey(!showEditApiKey)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                            >
                              {showEditApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={cancelEditing}
                          className="flex-1"
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={() => handleEditProvider(provider)}
                          disabled={isEditLoading}
                          className="flex-1"
                        >
                          {isEditLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Save
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{meta?.displayName || provider.provider}</span>
                          </div>
                          <p className="text-sm text-zinc-500">{meta?.requiresApiKey ? "API Key" : "OAuth"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {isGeminiCLI ? (
                          isCheckingGemini ? (
                            <Badge variant="outline" className="text-xs text-zinc-400">
                              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              Checking...
                            </Badge>
                          ) : geminiStatus?.authenticated ? (
                            <Badge variant="outline" className="text-xs text-green-400">
                              <Check className="mr-1 h-3 w-3" />
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-amber-400">
                              <X className="mr-1 h-3 w-3" />
                              Not Connected
                            </Badge>
                          )
                        ) : provider.hasApiKey ? (
                          <Badge variant="outline" className="text-xs text-green-400">
                            <Check className="mr-1 h-3 w-3" />
                            Connected
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs text-amber-400">
                            <X className="mr-1 h-3 w-3" />
                            No API Key
                          </Badge>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEditing(provider)}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4 text-zinc-500 hover:text-white" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Delete">
                              <Trash2 className="h-4 w-4 text-zinc-500 hover:text-red-400" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Provider?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete &quot;{meta?.displayName}&quot;? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => onDeleteProvider(provider.id)}
                                className="bg-red-600 hover:bg-red-500"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {isAddingProvider ? (
              <div className="p-4 rounded-lg border border-zinc-700 bg-zinc-900/50 space-y-4">
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={selectedProviderType} onValueChange={setSelectedProviderType}>
                    <SelectTrigger className="w-full bg-zinc-950/50 border-zinc-800">
                      <SelectValue placeholder="Select a provider" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableProviders.length === 0 ? (
                        <SelectItem value="none" disabled>
                          All providers added
                        </SelectItem>
                      ) : (
                        availableProviders.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.displayName}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>

                {selectedProviderType && selectedProviderType === "gemini_cli_oauth" && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      {isCheckingGemini ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                          <span className="text-zinc-400">Checking Gemini CLI status...</span>
                        </>
                      ) : geminiStatus ? (
                        <>
                          {geminiStatus.authenticated ? (
                            <Check className="h-4 w-4 text-green-400" />
                          ) : (
                            <X className="h-4 w-4 text-amber-400" />
                          )}
                          <span className={geminiStatus.authenticated ? "text-green-400" : "text-amber-400"}>
                            {geminiStatus.message}
                          </span>
                        </>
                      ) : null}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={checkGeminiStatus}
                      className="w-full"
                    >
                      <Terminal className="mr-2 h-4 w-4" />
                      Check Gemini CLI Status
                    </Button>
                  </div>
                )}

                {selectedProviderType && getProviderMeta(selectedProviderType)?.requiresApiKey && (
                  <div className="space-y-2">
                    <Label>API Key</Label>
                    <div className="relative">
                      <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                      <Input
                        type={showApiKey ? "text" : "password"}
                        placeholder="Enter API key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        className="w-full pl-9 pr-10 bg-zinc-950/50 border-zinc-800"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Your API key is stored locally and encrypted.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleCancelAdd} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleAddProvider}
                    disabled={isLoading || !selectedProviderType}
                    className="flex-1"
                  >
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Add Provider
                  </Button>
                </div>
              </div>
            ) : (
              availableProviders.length > 0 && (
                <Button
                  variant="outline"
                  className="w-full border-dashed"
                  onClick={() => setIsAddingProvider(true)}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Another Provider
                </Button>
              )
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
