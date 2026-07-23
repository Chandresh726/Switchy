"use client";

import { AlertTriangle, FileX, Sparkles, Trash2 } from "lucide-react";

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
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";

interface DangerZoneProps {
  onClearAIContent: () => void;
  onClearMatchData: () => void;
  onClearJobs: () => void;
}

const dangerButtonClass =
  "w-48 justify-center border-red-900/40 text-red-400 hover:bg-red-950/40 hover:text-red-300 hover:border-red-900/60";

export function DangerZone({ onClearAIContent, onClearMatchData, onClearJobs }: DangerZoneProps) {
  return (
    <Card className="border-border bg-card/70 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <CardTitle className="text-base text-red-500">Danger Zone</CardTitle>
        </div>
        <CardDescription>Destructive actions that cannot be undone.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Delete AI Generated Content */}
        <div className="flex items-center justify-between gap-6">
          <div className="flex-1 min-w-0 space-y-1">
            <Label className="text-sm">Delete AI Generated Content</Label>
            <p className="text-xs text-muted-foreground">
              Permanently removes all AI-generated cover letters, referral messages, and recruiter
              follow-ups. Job listings and match data are preserved.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className={dangerButtonClass}>
                <FileX />
                Delete AI Content
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent showCloseButton>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All AI Generated Content?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2" asChild>
                  <div>
                    <p>This action will permanently delete:</p>
                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                      <li>All generated cover letters</li>
                      <li>All generated referral messages</li>
                      <li>All recruiter follow-up messages</li>
                      <li>Generation history and variants</li>
                    </ul>
                    <p className="mt-2 font-medium text-foreground/80">
                      Your job listings, match scores, and company data will NOT be deleted.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction
                  className="w-full bg-red-600 hover:bg-red-700 text-foreground"
                  onClick={onClearAIContent}
                >
                  Yes, Delete Content
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Delete Match History */}
        <div className="flex items-center justify-between gap-6 pt-6 border-t border-border">
          <div className="flex-1 min-w-0 space-y-1">
            <Label className="text-sm">Delete Match History</Label>
            <p className="text-xs text-muted-foreground">
              Permanently removes all match scores and AI reasoning. Job listings are preserved.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className={dangerButtonClass}>
                <Sparkles />
                Delete Match Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent showCloseButton>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All Match History?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2" asChild>
                  <div>
                    <p>This action will permanently delete:</p>
                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                      <li>All AI match scores and confidence levels</li>
                      <li>Generated match reasoning and analysis</li>
                      <li>Historical records of match runs</li>
                    </ul>
                    <p className="mt-2 font-medium text-foreground/80">
                      Your scraped job listings and company data will NOT be deleted.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction
                  className="w-full bg-red-600 hover:bg-red-700 text-foreground"
                  onClick={onClearMatchData}
                >
                  Yes, Delete History
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Delete All Jobs */}
        <div className="flex items-center justify-between gap-6 pt-6 border-t border-border">
          <div className="flex-1 min-w-0 space-y-1">
            <Label className="text-sm">Delete All Jobs</Label>
            <p className="text-xs text-muted-foreground">
              Permanently removes all scraped jobs and their associated data. Companies remain tracked.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className={dangerButtonClass}>
                <Trash2 />
                Delete Jobs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent showCloseButton>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All Jobs</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2" asChild>
                  <div>
                    <p>This action will permanently delete:</p>
                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                      <li>All scraped job postings</li>
                      <li>Match scores and AI reasoning for jobs</li>
                      <li>AI-generated cover letters, referrals, and recruiter follow-ups</li>
                    </ul>
                    <p className="mt-2 font-medium text-foreground/80">
                      Your tracked companies will NOT be deleted.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogAction
                  className="w-full bg-red-600 hover:bg-red-700 text-foreground"
                  onClick={onClearJobs}
                >
                  Yes, Delete All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
