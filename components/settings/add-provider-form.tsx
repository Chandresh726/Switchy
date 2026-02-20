"use client";

import { useState } from "react";
import { ChevronUp, Key, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getAllProviderMetadata } from "@/lib/ai/providers/metadata";

interface AddProviderFormProps {
  onAddProvider: (provider: string, apiKey?: string) => Promise<void>;
}

export function AddProviderForm({ onAddProvider }: AddProviderFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<string>("");
  const [apiKey, setApiKey] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providers = getAllProviderMetadata();
  const selectedMetadata = providers.find((p) => p.id === selectedProvider);

  const handleSubmit = async () => {
    if (!selectedProvider) {
      setError("Please select a provider");
      return;
    }

    if (selectedMetadata?.requiresApiKey && !apiKey) {
      setError("API key is required for this provider");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      await onAddProvider(selectedProvider, apiKey || undefined);
      setSelectedProvider("");
      setApiKey("");
      setIsExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-border bg-card/70">
      <CardContent className="pt-6">
        {!isExpanded ? (
          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={() => setIsExpanded(true)}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add AI Provider
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Add New Provider</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(false)}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
            </div>

              <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="provider">Provider</Label>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger id="provider" className="w-full bg-background/60 border-border">
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedMetadata?.requiresApiKey && (
                <div className="space-y-2">
                  <Label htmlFor="apiKey">API Key</Label>
                  <div className="relative">
                    <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="apiKey"
                      type="password"
                      placeholder="Enter API key"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      className="w-full pl-9 bg-background/60 border-border"
                    />
                  </div>
                  {selectedMetadata.apiKeyUrl && (
                    <p className="text-xs text-muted-foreground">
                      <a
                        href={selectedMetadata.apiKeyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline"
                      >
                        Get API Key here
                      </a>
                      {selectedMetadata.freeTierNote ? ` - ${selectedMetadata.freeTierNote}` : ""}
                    </p>
                  )}
                </div>
              )}

              {!selectedMetadata?.requiresApiKey && selectedProvider && (
                <div className="rounded-lg bg-blue-500/10 p-4 text-sm text-blue-400">
                  This provider does not require an API key.
                </div>
              )}

              {error && (
                <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsExpanded(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isLoading || !selectedProvider}
                  className="flex-1"
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Provider
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
