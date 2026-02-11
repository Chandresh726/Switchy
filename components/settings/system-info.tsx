"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Database, Server } from "lucide-react";

export function SystemInfo() {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <CardTitle className="text-base">System Info</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-500">Version</Label>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-zinc-400 border-zinc-800">v0.1.0</Badge>
            <span className="text-xs text-zinc-600">Beta</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-500">Database</Label>
          <div className="flex items-center gap-2 rounded-md bg-zinc-950/50 border border-zinc-800 px-3 py-2">
            <Database className="h-3.5 w-3.5 text-zinc-500" />
            <code className="text-xs text-zinc-400">~/.switchy/switchy.db</code>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-500">Platforms</Label>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 hover:bg-zinc-700">Greenhouse</Badge>
            <Badge variant="secondary" className="bg-zinc-800 text-zinc-400 hover:bg-zinc-700">Lever</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
