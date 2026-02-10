import { db } from "@/lib/db";
import { profile, skills, experience, education, resumes } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
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
    console.error("Failed to fetch profile:", error);
    return NextResponse.json(
      { error: "Failed to fetch profile" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
        .where(eq(profile.id, existingProfiles[0].id))
        .returning();

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

      return NextResponse.json(newProfile);
    }
  } catch (error) {
    console.error("Failed to save profile:", error);
    return NextResponse.json(
      { error: "Failed to save profile" },
      { status: 500 }
    );
  }
}
