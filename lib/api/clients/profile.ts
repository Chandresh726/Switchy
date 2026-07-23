import {
  educationCreateBodySchema,
  childIdParamsSchema,
  educationSchema,
  educationResponseSchema,
  educationUpdateBodySchema,
  experienceSchema,
  experienceResponseSchema,
  experienceUpdateBodySchema,
  experienceWriteBodySchema,
  profileIdQuerySchema,
  profileResponseSchema,
  profileSchema,
  profileWriteBodySchema,
  resumeUploadResponseSchema,
  resumeUploadFormSchema,
  resumeSectionApplyBodySchema,
  resumeSectionApplyResponseSchema,
  skillCreateBodySchema,
  skillSchema,
  skillsResponseSchema,
} from "@/lib/api/contracts/profile";
import type {
  Profile,
  ProfileResponse,
  ResumeUploadResponse,
  ResumeSectionApplyInput,
  ResumeSectionApplyResponse,
  SkillCreateInput,
} from "@/lib/api/contracts/profile";
import { successSchema } from "@/lib/api/contracts/common";
import type { z } from "zod";

import { apiCommand, apiFileRequest, apiGet, apiJsonMutation, apiRequest, serializePathParam, serializeQuery } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

export const getProfile = (): Promise<ProfileResponse> => apiGet("/api/profile", profileResponseSchema, "Failed to fetch profile");
const profileQuery = (profileId: number) => serializeQuery(profileIdQuerySchema, { profileId });
const childPath = (id: number) => serializePathParam(childIdParamsSchema, { id });

export const getSkills = (profileId: number) => apiGet(`/api/profile/skills?${profileQuery(profileId)}`, skillsResponseSchema, "Failed to fetch skills");
export const getExperience = (profileId: number) => apiGet(`/api/profile/experience?${profileQuery(profileId)}`, experienceResponseSchema, "Failed to fetch experience");
export const getEducation = (profileId: number) => apiGet(`/api/profile/education?${profileQuery(profileId)}`, educationResponseSchema, "Failed to fetch education");
export const saveProfile = (body: z.input<typeof profileWriteBodySchema>): Promise<Profile> => apiJsonMutation("/api/profile", "POST", profileWriteBodySchema, body, profileSchema, "Failed to save profile");
export const createSkill = (body: SkillCreateInput) => apiJsonMutation("/api/profile/skills", "POST", skillCreateBodySchema, body, skillSchema, "Failed to create skill");
export const deleteSkill = (id: number) => apiCommand(`/api/profile/skills/${childPath(id)}`, "DELETE", successSchema, "Failed to delete skill");
export const createExperience = (body: z.output<typeof experienceWriteBodySchema>) => apiJsonMutation("/api/profile/experience", "POST", experienceWriteBodySchema, body, experienceSchema, "Failed to create experience");
export const updateExperience = (id: number, body: z.output<typeof experienceUpdateBodySchema>) => apiJsonMutation(`/api/profile/experience/${childPath(id)}`, "PATCH", experienceUpdateBodySchema, body, experienceSchema, "Failed to update experience");
export const deleteExperience = (id: number) => apiCommand(`/api/profile/experience/${childPath(id)}`, "DELETE", successSchema, "Failed to delete experience");
export const createEducation = (body: z.output<typeof educationCreateBodySchema>) => apiJsonMutation("/api/profile/education", "POST", educationCreateBodySchema, body, educationResponseSchema, "Failed to create education");
export const updateEducation = (id: number, body: z.output<typeof educationUpdateBodySchema>) => apiJsonMutation(`/api/profile/education/${childPath(id)}`, "PATCH", educationUpdateBodySchema, body, educationSchema, "Failed to update education");
export const deleteEducation = (id: number) => apiCommand(`/api/profile/education/${childPath(id)}`, "DELETE", successSchema, "Failed to delete education");
export const deleteResume = (id: number) => apiCommand(`/api/profile/resumes/${childPath(id)}`, "DELETE", successSchema, "Failed to delete resume");
export const applyResumeSection = (
  body: ResumeSectionApplyInput
): Promise<ResumeSectionApplyResponse> => apiJsonMutation(
  "/api/profile/resume-review",
  "POST",
  resumeSectionApplyBodySchema,
  body,
  resumeSectionApplyResponseSchema,
  "Failed to apply resume changes"
);
export const uploadResume = (formData: FormData): Promise<ResumeUploadResponse> => {
  resumeUploadFormSchema.parse({
    file: formData.get("file"),
    autofill: formData.get("autofill") ?? undefined,
  });
  return apiRequest("/api/profile/parse-resume", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, resumeUploadResponseSchema, "Failed to upload resume");
};

export async function downloadResume(id: number): Promise<void> {
  const { blob, fileName } = await apiFileRequest(
    `/api/profile/resumes/${childPath(id)}/download`,
    { method: "GET" },
    "Failed to download resume"
  );
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName ?? `resume-${id}`;
    anchor.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
