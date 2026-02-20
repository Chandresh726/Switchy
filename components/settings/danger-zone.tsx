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
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, FileX, Sparkles, Trash2 } from "lucide-react";

interface DangerZoneProps {
  onClearAIContent: () => void;
  onClearMatchData: () => void;
  onClearJobs: () => void;
}

export function DangerZone({ onClearAIContent, onClearMatchData, onClearJobs }: DangerZoneProps) {
  return (
    <Card className="border-red-900/20 bg-red-950/5 rounded-xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-500" />
          <CardTitle className="text-red-500">Danger Zone</CardTitle>
        </div>
        <CardDescription className="text-red-400/60">
          Destructive actions that cannot be undone
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-0">
        {/* Delete AI Generated Content */}
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-red-500/10 p-2">
              <FileX className="h-4 w-4 text-red-400" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">Delete AI Generated Content</h4>
              <p className="text-xs text-muted-foreground max-w-md">
                Permanently removes all AI-generated cover letters and referral messages. Job listings and match data are preserved.
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50 shrink-0"
              >
                <FileX className="mr-2 h-4 w-4" />
                Delete AI Content
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All AI Generated Content?</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2" asChild>
                  <div>
                    <p>This action will permanently delete:</p>
                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                      <li>All generated cover letters</li>
                      <li>All generated referral messages</li>
                      <li>Generation history and variants</li>
                    </ul>
                    <p className="mt-2 font-medium text-foreground/80">
                      Your job listings, match scores, and company data will NOT be deleted.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 text-foreground"
                  onClick={onClearAIContent}
                >
                  Yes, Delete Content
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator className="bg-red-900/10" />

        {/* Delete Match History */}
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-red-500/10 p-2">
              <Sparkles className="h-4 w-4 text-red-400" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">Delete Match History</h4>
              <p className="text-xs text-muted-foreground max-w-md">
                Permanently removes all match scores and AI reasoning. Job listings are preserved.
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50 shrink-0"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Delete Match Data
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
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
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 text-foreground"
                  onClick={onClearMatchData}
                >
                  Yes, Delete History
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <Separator className="bg-red-900/10" />

        {/* Delete All Jobs */}
        <div className="flex items-center justify-between gap-4 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-lg bg-red-500/10 p-2">
              <Trash2 className="h-4 w-4 text-red-400" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-medium text-foreground">Delete All Jobs</h4>
              <p className="text-xs text-muted-foreground max-w-md">
                Permanently removes all scraped jobs and their associated data. Companies remain tracked.
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button 
                variant="outline" 
                size="sm" 
                className="border-red-900/30 text-red-400 hover:bg-red-950/30 hover:text-red-300 hover:border-red-900/50 shrink-0"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Jobs
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete All Jobs</AlertDialogTitle>
                <AlertDialogDescription className="space-y-2" asChild>
                  <div>
                    <p>This action will permanently delete:</p>
                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                      <li>All scraped job postings</li>
                      <li>Match scores and AI reasoning for jobs</li>
                      <li>AI-generated cover letters and referrals</li>
                    </ul>
                    <p className="mt-2 font-medium text-foreground/80">
                      Your tracked companies will NOT be deleted.
                    </p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 text-foreground"
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
