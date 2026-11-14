"use client";

import { Moon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface PowerSettingsProps {
  keepDeviceAwake: boolean;
  onKeepDeviceAwakeChange: (value: boolean) => void;
}

export const PowerSettings = ({ keepDeviceAwake, onKeepDeviceAwakeChange }: PowerSettingsProps) => (
  <Card className="border-border bg-card/70 rounded-xl">
    <CardHeader className="pb-3">
      <div className="flex items-center gap-2">
        <Moon className="h-4 w-4 text-amber-500" />
        <CardTitle className="text-base">Power</CardTitle>
        <Badge variant="secondary" className="ml-auto">macOS</Badge>
      </div>
    </CardHeader>
    <CardContent>
      <div className="flex items-center justify-between gap-6">
        <div className="space-y-1">
          <Label htmlFor="keep-device-awake">Keep awake while scraping or matching</Label>
          <p className="text-xs text-muted-foreground">Display can sleep. Closing the lid still sleeps.</p>
        </div>
        <Switch id="keep-device-awake" checked={keepDeviceAwake} onCheckedChange={onKeepDeviceAwakeChange} />
      </div>
    </CardContent>
  </Card>
);
