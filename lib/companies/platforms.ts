export const PLATFORMS = [
  "greenhouse",
  "smartrecruiters",
  "lever",
  "ashby",
  "eightfold",
  "workday",
  "servicenow",
  "turbohire",
  "mynexthire",
  "uber",
  "google",
  "atlassian",
  "rippling",
  "visa",
  "jobvite",
  "talentbrew",
  "oracle",
  "phenom",
] as const;

export type Platform = (typeof PLATFORMS)[number];
export const COMPANY_PLATFORMS = [...PLATFORMS, "custom"] as const;

export const PLATFORM_METADATA = {
  greenhouse: { label: "Greenhouse", color: "border-green-500/30 bg-green-500/10 text-green-300" },
  smartrecruiters: { label: "SmartRecruiters", color: "border-purple-500/30 bg-purple-500/10 text-purple-300" },
  lever: { label: "Lever", color: "border-blue-500/30 bg-blue-500/10 text-blue-300" },
  ashby: { label: "Ashby", color: "border-sky-500/30 bg-sky-500/10 text-sky-300" },
  eightfold: { label: "Eightfold", color: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" },
  workday: { label: "Workday", color: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  servicenow: { label: "ServiceNow", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  turbohire: { label: "TurboHire", color: "border-orange-500/30 bg-orange-500/10 text-orange-300" },
  mynexthire: { label: "MynextHire", color: "border-teal-500/30 bg-teal-500/10 text-teal-300" },
  uber: { label: "Uber", color: "border-neutral-400/30 bg-neutral-400/10 text-neutral-200" },
  google: { label: "Google", color: "border-rose-500/30 bg-rose-500/10 text-rose-300" },
  atlassian: { label: "Atlassian", color: "border-blue-400/30 bg-blue-400/10 text-blue-200" },
  rippling: { label: "Rippling", color: "border-yellow-500/30 bg-yellow-500/10 text-yellow-300" },
  visa: { label: "Visa", color: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300" },
  jobvite: { label: "Jobvite", color: "border-violet-500/30 bg-violet-500/10 text-violet-300" },
  talentbrew: { label: "TalentBrew", color: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300" },
  oracle: { label: "Oracle Recruiting", color: "border-red-500/30 bg-red-500/10 text-red-300" },
  phenom: { label: "Phenom", color: "border-lime-500/30 bg-lime-500/10 text-lime-300" },
  custom: { label: "Custom", color: "border-border bg-muted/40 text-muted-foreground" },
} as const;

export const PLATFORM_OPTIONS = COMPANY_PLATFORMS.map((value) => ({ value, label: PLATFORM_METADATA[value].label }));
export const PLATFORM_COLORS: Record<string, string> = Object.fromEntries(
  COMPANY_PLATFORMS.map((value) => [value, PLATFORM_METADATA[value].color])
);
