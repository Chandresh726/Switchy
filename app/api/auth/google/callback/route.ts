import { NextRequest, NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error) {
      return NextResponse.redirect(new URL(`/settings?error=${error}`, request.url));
    }

    if (!code) {
      return NextResponse.redirect(new URL("/settings?error=no_code", request.url));
    }

    // 1. Get Verifier from cookie
    const codeVerifier = request.cookies.get("google_code_verifier")?.value;
    if (!codeVerifier) {
      return NextResponse.redirect(new URL("/settings?error=no_verifier", request.url));
    }

    // 2. Get Client ID/Secret
    const clientId = await getSetting("google_client_id");
    const clientSecret = await getSetting("google_client_secret");

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL("/settings?error=missing_credentials_callback", request.url));
    }

    // 3. Exchange Code for Tokens
    const redirectUri = "http://localhost:3000/api/auth/google/callback";
    const oAuth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

    const { tokens } = await oAuth2Client.getToken({
      code,
      codeVerifier,
    });

    if (!tokens.access_token) {
        throw new Error("No access token received");
    }

    // 4. Discover Project
    try {
        const projectId = await discoverProject(tokens.access_token);
        if (projectId) {
            console.log("Project discovered:", projectId);
            await saveSetting("google_project_id", projectId);
        } else {
            console.warn("No project discovered");
        }
    } catch (e) {
        console.error("Project discovery failed:", e);
        // Don't fail the whole flow, but warn
    }

    // 5. Save Tokens
    // We store the whole token object (access_token, refresh_token, expiry_date, etc.)
    await saveSetting("google_oauth_tokens", JSON.stringify(tokens));
    await saveSetting("google_auth_mode", "oauth");
    await saveSetting("ai_provider", "google");

    // 6. Redirect back to settings with success
    const response = NextResponse.redirect(new URL("/settings?success=google_connected", request.url));

    // Clear verifier cookie
    response.cookies.delete("google_code_verifier");

    return response;
  } catch (error) {
    console.error("OAuth Callback Error:", error);
    return NextResponse.redirect(new URL("/settings?error=token_exchange_failed", request.url));
  }
}

async function getSetting(key: string) {
  const result = await db.select().from(settings).where(eq(settings.key, key));
  return result[0]?.value;
}

async function saveSetting(key: string, value: string) {
    const existing = await db.select().from(settings).where(eq(settings.key, key));
    if (existing.length > 0) {
        await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key));
    } else {
        await db.insert(settings).values({ key, value });
    }
}

// Project Discovery Helper (ported from gemini-cli logic)
async function discoverProject(accessToken: string): Promise<string | null> {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  try {
    // 1. Try to load Code Assist (discovers project/tier)
    const loadResponse = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          // cloudaicompanionProject: envProject, // We don't have env var usually
          metadata: {
            ideType: "IDE_UNSPECIFIED",
            platform: "PLATFORM_UNSPECIFIED",
            pluginType: "GEMINI",
          },
        }),
      }
    );

    let data = await loadResponse.json();

    // If VPC-SC protected, fall back to standard tier logic (from snippet)
    if (!loadResponse.ok) {
       // Simple check for now, assume failed load means we might need onboarding
       console.log("loadCodeAssist failed, trying onboarding logic...");
    } else if (data.currentTier) {
       // If user already has a project, return it
       const project = data.cloudaicompanionProject;
       if (typeof project === "string" && project) return project;
       if (typeof project === "object" && project?.id) return project.id;
    }

    // 2. Otherwise, onboard user and discover/create project
    // Default to free-tier or standard-tier based on allowedTiers
    // Simplified: just try to onboard with free-tier or whatever defaults
    const onboardBody: Record<string, unknown> = {
      tierId: "free-tier", // Default to free tier
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    };

    const onboardResponse = await fetch(
      "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
      {
        method: "POST",
        headers,
        body: JSON.stringify(onboardBody),
      }
    );

    const lro = await onboardResponse.json();
    console.log("Onboard response:", JSON.stringify(lro));

    // In a full impl we'd poll the LRO, but often the project ID is returned immediately
    // or we can just try to use the one from the response structure if present.
    const projectId = lro.response?.cloudaicompanionProject?.id;
    if (projectId) return projectId;

    return null;
  } catch (err) {
    console.error("Error discovering project:", err);
    return null;
  }
}
