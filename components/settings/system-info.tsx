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

interface SystemInfoProps {
  version: string;
  dbPath: string;
}

export function SystemInfo({ version, dbPath }: SystemInfoProps) {
  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">System Info</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Version</Label>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-muted-foreground border-border">v{version}</Badge>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Database</Label>
          <div className="flex items-center gap-2 rounded-md bg-background/60 border border-border px-3 py-2">
            <Database className="h-3.5 w-3.5 text-muted-foreground" />
            <code className="text-xs text-muted-foreground">{dbPath}</code>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Platforms</Label>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Greenhouse</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Lever</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Ashby</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Eightfold</Badge>
            <Badge variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted">Workday</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
