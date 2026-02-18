import type {
  LocationType,
  DescriptionFormat,
  EmploymentType,
  SeniorityLevel,
} from "./platform";

export interface ScrapedJob {
  externalId: string;
  title: string;
  url: string;
  location?: string;
  locationType?: LocationType;
  department?: string;
  description?: string;
  descriptionFormat?: DescriptionFormat;
  salary?: string;
  employmentType?: EmploymentType;
  seniorityLevel?: SeniorityLevel;
  postedDate?: Date;
}

export interface ExistingJob {
  id: number;
  externalId: string | null;
  title: string;
  url: string;
}

export interface JobInsert {
  companyId: number;
  externalId: string;
  title: string;
  url: string;
  location?: string;
  locationType?: LocationType;
  department?: string;
  description?: string;
  descriptionFormat: DescriptionFormat;
  salary?: string;
  employmentType?: EmploymentType;
  seniorityLevel?: SeniorityLevel;
  postedDate?: Date;
  status: "new";
}

export function toJobInsert(
  job: ScrapedJob,
  companyId: number
): JobInsert {
  return {
    companyId,
    externalId: job.externalId,
    title: job.title,
    url: job.url,
    location: job.location,
    locationType: job.locationType,
    department: job.department,
    description: job.description,
    descriptionFormat: job.descriptionFormat ?? "plain",
    salary: job.salary,
    employmentType: job.employmentType,
    seniorityLevel: job.seniorityLevel,
    postedDate: job.postedDate,
    status: "new",
  };
}
