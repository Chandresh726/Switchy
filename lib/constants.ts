export const APP_VERSION = "0.5.0";
export const DB_PATH = process.env.NODE_ENV === "development" 
  ? "~/.switchy/dev/switchy.db" 
  : "~/.switchy/switchy.db";

export const PLATFORM_OPTIONS = [
  { value: "greenhouse", label: "Greenhouse" },
  { value: "lever", label: "Lever" },
  { value: "ashby", label: "Ashby" },
  { value: "eightfold", label: "Eightfold" },
  { value: "workday", label: "Workday" },
  { value: "uber", label: "Uber" },
  { value: "custom", label: "Custom" },
] as const;
