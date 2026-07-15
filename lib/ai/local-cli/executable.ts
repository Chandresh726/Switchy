import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { CLI_EXECUTABLE_CONFIG } from "@/lib/ai/local-cli/constants";
import type { LocalCLIProvider } from "@/lib/ai/providers/types";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function getSettingOverride(key: string): Promise<string | undefined> {
  const row = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  const value = row[0]?.value?.trim();
  return value || undefined;
}

export async function resolveCLIExecutable(
  provider: LocalCLIProvider
): Promise<string | null> {
  const config = CLI_EXECUTABLE_CONFIG[provider];
  const override = await getSettingOverride(config.settingKey);
  const environmentOverride = process.env[config.environmentVariable]?.trim();

  for (const explicit of [override, environmentOverride]) {
    if (explicit) return (await isExecutable(explicit)) ? explicit : null;
  }

  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, config.command);
    if (await isExecutable(candidate)) return candidate;
  }

  return null;
}
