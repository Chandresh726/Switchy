export const APP_VERSION = "0.5.0";
export const DB_PATH = process.env.NODE_ENV === "development" 
  ? "~/.switchy/dev/switchy.db" 
  : "~/.switchy/switchy.db";

export const MAX_CSV_FILE_SIZE = 10 * 1024 * 1024;

export const PLATFORM_OPTIONS = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "eightfold", label: "Eightfold" },
  { value: "workday", label: "Workday" },
  { value: "uber", label: "Uber" },
  { value: "custom", label: "Custom" },
] as const;

export const PLATFORM_COLORS: Record<string, string> = {
  greenhouse: "border-green-500/30 bg-green-500/10 text-green-300",
  lever: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  ashby: "border-sky-500/30 bg-sky-500/10 text-sky-300",
  eightfold: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300",
  workday: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  custom: "border-border bg-muted/40 text-muted-foreground",
};
