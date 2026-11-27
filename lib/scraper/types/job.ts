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
  /** Source country/location hints for filtering, independent of display text. */
  country?: string;
  locations?: string[];
  locationType?: LocationType;
  department?: string;
  description?: string;
  descriptionFormat?: DescriptionFormat;
  salary?: string;
  employmentType?: EmploymentType;
  seniorityLevel?: SeniorityLevel;
  postedDate?: Date;
  sourceUpdatedAt?: Date;
  descriptionQuality?: "full" | "teaser";
}
