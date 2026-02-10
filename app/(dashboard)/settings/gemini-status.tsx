"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, AlertCircle, Terminal, RefreshCw } from "lucide-react";
import { getGeminiStatus, type GeminiStatus } from "@/app/actions/gemini";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export function GeminiStatusDisplay() {
  const [status, setStatus] = useState<GeminiStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkStatus = async () => {
    setIsLoading(true);
    try {
      const result = await getGeminiStatus();
      setStatus(result);
    } catch (error) {
      console.error("Failed to check Gemini status:", error);
      toast.error("Failed to check Gemini CLI status");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500 py-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking Gemini CLI status...
      </div>
    );
  }

  if (!status?.installed) {
    return (
      <div className="rounded-lg border border-red-900/20 bg-red-950/10 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h4 className="text-sm font-medium text-red-400">Gemini CLI Not Installed</h4>
            <p className="text-xs text-red-400/80 leading-relaxed">
              The <code>gemini</code> command was not found in your PATH.
            </p>
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded p-3 ml-8">
          <p className="text-xs text-zinc-500 mb-2">Run this in your terminal to install:</p>
          <code className="text-xs font-mono text-zinc-300 block">npm install -g @google/gemini-cli</code>
        </div>
        <div className="pl-8 pt-1">
           <Button
            variant="outline"
            size="sm"
            onClick={checkStatus}
            className="h-7 text-xs border-red-900/30 text-red-400 hover:bg-red-950/20"
          >
            <RefreshCw className="mr-2 h-3 w-3" />
            Check Again
          </Button>
        </div>
      </div>
    );
  }

  if (!status.authenticated) {
    return (
      <div className="rounded-lg border border-yellow-900/20 bg-yellow-950/10 p-4 space-y-3">
        <div className="flex items-start gap-3">
          <Terminal className="h-5 w-5 text-yellow-500 mt-0.5" />
          <div className="flex-1 space-y-1">
            <h4 className="text-sm font-medium text-yellow-400">Authentication Required</h4>
            <p className="text-xs text-yellow-400/80 leading-relaxed">
              Gemini CLI is installed but no valid credentials were found.
            </p>
          </div>
        </div>
        <div className="bg-zinc-950 border border-zinc-800 rounded p-3 ml-8">
          <p className="text-xs text-zinc-500 mb-2">Run this in your terminal to authenticate:</p>
          <code className="text-xs font-mono text-yellow-300 block">gemini auth login</code>
        </div>
        <div className="pl-8 pt-1">
           <Button
            variant="outline"
            size="sm"
            onClick={checkStatus}
            className="h-7 text-xs border-yellow-900/30 text-yellow-400 hover:bg-yellow-950/20"
          >
            <RefreshCw className="mr-2 h-3 w-3" />
            I've Authenticated
          </Button>
        </div>
      </div>
    );
  }

  // Ready State
  return (
    <div className="rounded-lg border border-emerald-900/20 bg-emerald-950/10 p-4">
      <div className="flex items-start gap-3">
        <div className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-500 mt-0.5">
          <CheckCircle2 className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-emerald-400">Ready to use</h4>
            <Button
              variant="ghost"
              size="sm"
              onClick={checkStatus}
              className="h-6 w-6 p-0 text-emerald-500/50 hover:text-emerald-400 hover:bg-emerald-950/30"
              title="Re-check status"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-xs text-emerald-400/70 leading-relaxed">
            Gemini CLI is installed and authenticated via OAuth.
          </p>
          {status.message && (
             <p className="text-[10px] font-mono text-emerald-500/40 mt-1">
               {status.message}
             </p>
          )}
        </div>
      </div>
    </div>
  );
}
