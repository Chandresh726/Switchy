import { NextResponse } from "next/server";
import { exec } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";
import util from "util";

const execAsync = util.promisify(exec);

async function isGeminiInstalled(): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      await execAsync("where gemini");
    } else {
      await execAsync("command -v gemini");
    }
    return true;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    const status = {
      installed: false,
      authenticated: false,
      message: "",
    };

    if (!(await isGeminiInstalled())) {
      status.message = "Gemini CLI not found in PATH. Please install it first.";
      return NextResponse.json(status);
    }
    status.installed = true;

    try {
      const credsPath = path.join(os.homedir(), ".gemini", "oauth_creds.json");

      try {
        await fs.access(credsPath);
      } catch {
        status.message = "Not authenticated. Run 'gemini auth login' in your terminal.";
        return NextResponse.json(status);
      }

      const fileContent = await fs.readFile(credsPath, "utf-8");
      const creds = JSON.parse(fileContent);

      if (creds.refresh_token || (creds.expiry_date && creds.expiry_date > Date.now())) {
        status.authenticated = true;
        status.message = "Connected and ready to use.";
      } else {
        status.message = "Credentials expired. Run 'gemini auth login' in your terminal.";
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      status.message = `Error: ${errorMessage}`;
    }

    return NextResponse.json(status);
  } catch (error) {
    console.error("Failed to check Gemini CLI status:", error);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
