"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { AlertTriangle, Eraser, Trash2 } from "lucide-react";

interface DangerZoneProps {
  onClearMatchData: () => void;
  onClearJobs: () => void;
}

export function DangerZone({ onClearMatchData, onClearJobs }: DangerZoneProps) {
  return (
    <Card className="border-red-900/20 bg-red-950/5 overflow-hidden rounded-xl">
      <CardHeader className="border-b border-red-900/10 pb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <CardTitle className="text-red-500">Danger Zone</CardTitle>
        </div>
        <CardDescription className="text-red-400/60">
          Destructive actions that cannot be undone
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid divide-y divide-red-900/10">
          {/* Clear Match Data Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 hover:bg-red-950/10 transition-colors">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-zinc-200">Delete Match History</h4>
              <p className="text-xs text-zinc-500 max-w-sm">
                Permanently removes all match scores and AI reasoning. Job listings are preserved.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50">
                  <Eraser className="mr-2 h-4 w-4" />
                  Delete Scores & History
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete All Match History?</AlertDialogTitle>
                  <AlertDialogDescription className="space-y-2" asChild>
                    <div>
                      <p>This action will permanently delete:</p>
                      <ul className="list-disc list-inside text-zinc-400 ml-2">
                        <li>All AI match scores and confidence levels</li>
                        <li>Generated match reasoning and analysis</li>
                        <li>Historical records of match runs</li>
                      </ul>
                      <p className="mt-2 font-medium text-zinc-300">
                        Your scraped job listings and company data will NOT be deleted.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={onClearMatchData}
                  >
                    Yes, Delete History
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          {/* Clear All Jobs Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 hover:bg-red-950/10 transition-colors">
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-zinc-200">Delete All Jobs</h4>
              <p className="text-xs text-zinc-500 max-w-sm">
                Permanently removes all scraped jobs and their associated data. Companies remain tracked.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50">
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Jobs
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete All Jobs</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete all jobs? This will remove all
                    scraped job postings from all companies. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-red-600 hover:bg-red-700"
                    onClick={onClearJobs}
                  >
                    Yes, Delete All
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
