import {
  educationSchema,
  educationResponseSchema,
  experienceSchema,
  experienceResponseSchema,
  profileResponseSchema,
  profileSchema,
  resumeUploadResponseSchema,
  skillSchema,
  skillsResponseSchema,
} from "@/lib/api/contracts/profile";
import { successSchema } from "@/lib/api/contracts/common";

import { apiGet, apiRequest } from "../client";
import { APP_REQUEST_HEADERS } from "../request-headers";

const jsonMutation = (method: "POST" | "PUT" | "DELETE", body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? APP_REQUEST_HEADERS : { "Content-Type": "application/json", ...APP_REQUEST_HEADERS },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const getProfile = () => apiGet("/api/profile", profileResponseSchema, "Failed to fetch profile");
export const getSkills = (profileId: number) => apiGet(`/api/profile/skills?profileId=${profileId}`, skillsResponseSchema, "Failed to fetch skills");
export const getExperience = (profileId: number) => apiGet(`/api/profile/experience?profileId=${profileId}`, experienceResponseSchema, "Failed to fetch experience");
export const getEducation = (profileId: number) => apiGet(`/api/profile/education?profileId=${profileId}`, educationResponseSchema, "Failed to fetch education");
export const saveProfile = (body: unknown) => apiRequest("/api/profile", jsonMutation("POST", body), profileSchema, "Failed to save profile");
export const createSkill = (body: Record<string, unknown>) => apiRequest("/api/profile/skills", jsonMutation("POST", body), skillSchema, "Failed to create skill");
export const deleteSkill = (id: number) => apiRequest(`/api/profile/skills?id=${id}`, jsonMutation("DELETE"), successSchema, "Failed to delete skill");
export const createExperience = (body: Record<string, unknown>) => apiRequest("/api/profile/experience", jsonMutation("POST", body), experienceSchema, "Failed to create experience");
export const updateExperience = (body: Record<string, unknown>) => apiRequest("/api/profile/experience", jsonMutation("PUT", body), experienceSchema, "Failed to update experience");
export const deleteExperience = (id: number) => apiRequest(`/api/profile/experience?id=${id}`, jsonMutation("DELETE"), successSchema, "Failed to delete experience");
export const createEducation = (body: Record<string, unknown>) => apiRequest("/api/profile/education", jsonMutation("POST", body), educationSchema, "Failed to create education");
export const updateEducation = (body: Record<string, unknown>) => apiRequest("/api/profile/education", jsonMutation("PUT", body), educationSchema, "Failed to update education");
export const deleteEducation = (id: number) => apiRequest(`/api/profile/education?id=${id}`, jsonMutation("DELETE"), successSchema, "Failed to delete education");
export const deleteResume = (id: number) => apiRequest(`/api/profile/resumes?id=${id}`, jsonMutation("DELETE"), successSchema, "Failed to delete resume");
export const uploadResume = (formData: FormData) => apiRequest("/api/profile/parse-resume", { method: "POST", headers: APP_REQUEST_HEADERS, body: formData }, resumeUploadResponseSchema, "Failed to upload resume");
