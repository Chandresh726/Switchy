"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, RefreshCw, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickActionsProps {
  onRefresh: () => void;
  isRefreshing: boolean;
  isRefreshSuccess: boolean;
  onMatchUnmatched: () => void;
  isMatching: boolean;
  isMatchSuccess: boolean;
  unmatchedCount: number;
  matchedCount?: number;
}

export function QuickActions({
  onRefresh,
  isRefreshing,
  isRefreshSuccess,
  onMatchUnmatched,
  isMatching,
  isMatchSuccess,
  unmatchedCount,
  matchedCount,
}: QuickActionsProps) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50 rounded-xl">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-blue-500" />
          <CardTitle className="text-base">Operations</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full justify-start border-zinc-800 hover:bg-zinc-800/50 hover:text-white"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing && "animate-spin")} />
            {isRefreshing ? "Refreshing..." : "Refresh Jobs"}
          </Button>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            className={cn(
              "w-full justify-start border-zinc-800 hover:bg-zinc-800/50 hover:text-white",
              unmatchedCount > 0 && "border-purple-500/30 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
            )}
            onClick={onMatchUnmatched}
            disabled={isMatching || unmatchedCount === 0}
          >
            <Sparkles className={cn("mr-2 h-4 w-4", isMatching && "animate-pulse")} />
            {isMatching ? "Matching..." : "Match Unmatched"}
            {unmatchedCount > 0 && (
              <Badge variant="secondary" className="ml-auto bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 border-none h-5">
                {unmatchedCount}
              </Badge>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
