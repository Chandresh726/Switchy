import { db } from "@/lib/db";
import { profile, skills, experience, education, resumes } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { assertAppRequest, handleApiError } from "@/lib/api";
import { profileWriteBodySchema } from "@/lib/api/contracts/profile";
import { scheduleProfileRematch } from "@/lib/ai/matcher/profile-rematch";

export async function GET(request: NextRequest) {
  try {
    const profiles = await db.select().from(profile).limit(1);

    if (profiles.length === 0) {
      return NextResponse.json(null);
    }

    const profileData = profiles[0];

    const [skillsData, experienceData, educationData, resumesData] = await Promise.all([
      db.select().from(skills).where(eq(skills.profileId, profileData.id)),
      db.select().from(experience).where(eq(experience.profileId, profileData.id)),
      db.select().from(education).where(eq(education.profileId, profileData.id)),
      db.select().from(resumes).where(eq(resumes.profileId, profileData.id)).orderBy(desc(resumes.version)),
    ]);

    return NextResponse.json({
      ...profileData,
      skills: skillsData,
      experience: experienceData,
      education: educationData,
      resumes: resumesData,
    });
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to fetch profile", fallbackCode: "profile_fetch_failed" });
  }
}

export async function POST(request: NextRequest) {
  try {
    assertAppRequest(request);

    const body = profileWriteBodySchema.parse(await request.json());
    const {
      name,
      email,
      phone,
      location,
      preferredCountry,
      preferredCity,
      linkedinUrl,
      githubUrl,
      portfolioUrl,
      resumePath,
      summary,
    } = body;

    // Check if profile exists
    const existingProfiles = await db.select().from(profile).limit(1);

    if (existingProfiles.length > 0) {
      const existingProfile = existingProfiles[0];
      const matchingFactsChanged =
        existingProfile.summary !== (summary ?? null) ||
        existingProfile.preferredCountry !== (preferredCountry ?? null) ||
        existingProfile.preferredCity !== (preferredCity ?? null);
      // Update existing profile
      const [updated] = await db
        .update(profile)
        .set({
          name,
          email,
          phone,
          location,
          preferredCountry,
          preferredCity,
          linkedinUrl,
          githubUrl,
          portfolioUrl,
          resumePath,
          summary,
          updatedAt: new Date(),
        })
        .where(eq(profile.id, existingProfile.id))
        .returning();

      if (matchingFactsChanged) await scheduleProfileRematch();
      return NextResponse.json(updated);
    } else {
      // Create new profile
      const [newProfile] = await db
        .insert(profile)
        .values({
          name,
          email,
          phone,
          location,
          preferredCountry,
          preferredCity,
          linkedinUrl,
          githubUrl,
          portfolioUrl,
          resumePath,
          summary,
        })
        .returning();

      await scheduleProfileRematch();
      return NextResponse.json(newProfile);
    }
  } catch (error) {
    return handleApiError(error, { request, fallbackMessage: "Failed to save profile", fallbackCode: "profile_save_failed" });
  }
}
