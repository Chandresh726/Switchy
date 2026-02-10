"use server";

import { exec } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);

export type GeminiStatus = {
  installed: boolean;
  authenticated: boolean;
  message?: string;
};

export async function getGeminiStatus(): Promise<GeminiStatus> {
  const status: GeminiStatus = {
    installed: false,
    authenticated: false,
  };

  // 1. Check if gemini CLI is installed
  try {
    // Try to find 'gemini' in path
    await execAsync("command -v gemini");
    status.installed = true;
  } catch (error) {
    status.message = "Gemini CLI not found in PATH.";
    return status;
  }

  // 2. Check if authenticated (oauth_creds.json exists and is valid)
  try {
    const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");

    // Check if file exists
    try {
      await fs.access(credsPath);
    } catch {
      status.message = "Credentials file not found.";
      return status;
    }

    // Read and parse file
    const fileContent = await fs.readFile(credsPath, "utf-8");
    const creds = JSON.parse(fileContent);

    // Check expiry
    if (creds.expiry_date && creds.expiry_date > Date.now()) {
      status.authenticated = true;
      status.message = "Authenticated and valid.";
    } else {
      status.message = "Credentials expired.";
    }
  } catch (error: any) {
    status.message = `Error checking credentials: ${error.message}`;
  }

  return status;
}
