import { NextResponse } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getGeminiCliCredentials } from "@/lib/ai/gemini-cli";
import crypto from "crypto";

export async function GET() {
  try {
    // 1. Get Client ID/Secret
    let clientId = await getSetting("google_client_id");
    let clientSecret = await getSetting("google_client_secret");

    // Try to extract from CLI if not in DB
    if (!clientId || !clientSecret) {
      const cliCreds = await getGeminiCliCredentials();
      if (cliCreds) {
        clientId = cliCreds.clientId;
        clientSecret = cliCreds.clientSecret;

        // Save to DB for the callback to use
        await saveSetting("google_client_id", clientId);
        await saveSetting("google_client_secret", clientSecret);
      }
    }

    if (!clientId || !clientSecret) {
      return NextResponse.redirect(new URL("/settings?error=missing_credentials", "http://localhost:3000"));
    }

    // 2. Generate PKCE
    const codeVerifier = crypto.randomBytes(32).toString("hex");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // 3. Create OAuth Client
    // Note: Desktop clients usually allow localhost redirects.
    // We use port 3000 as that's where we are running.
    const redirectUri = "http://localhost:3000/api/auth/google/callback";
    const oAuth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);

    // 4. Generate Auth URL
    const authorizeUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      // Use the same scopes as the Gemini CLI to ensure compatibility
      scope: [
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile"
      ],
      code_challenge: codeChallenge,
      code_challenge_method: "S256" as any,
      prompt: "consent", // Force refresh token
    });

    // 5. Redirect user and store verifier in cookie
    const response = NextResponse.redirect(authorizeUrl);

    // Cookie valid for 10 minutes
    response.cookies.set("google_code_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 10,
      path: "/",
      sameSite: "lax"
    });

    return response;
  } catch (error) {
    console.error("OAuth Init Error:", error);
    return NextResponse.redirect(new URL("/settings?error=oauth_init_failed", "http://localhost:3000"));
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
