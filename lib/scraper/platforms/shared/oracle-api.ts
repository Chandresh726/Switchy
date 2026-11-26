import { z } from "zod";

const NullableStringSchema = z.string().nullable().optional();
const OracleLocationSchema = z
  .object({ LocationName: NullableStringSchema })
  .passthrough();
export const OracleListingSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string().min(1),
    PrimaryLocation: NullableStringSchema,
    PrimaryLocationCountry: NullableStringSchema,
    PostedDate: NullableStringSchema,
    WorkplaceType: NullableStringSchema,
    JobType: NullableStringSchema,
    JobFamily: NullableStringSchema,
    JobFunction: NullableStringSchema,
    Category: NullableStringSchema,
    Department: NullableStringSchema,
    Organization: NullableStringSchema,
    otherWorkLocations: z.array(OracleLocationSchema).nullish().transform((value) => value ?? undefined),
    secondaryLocations: z.array(OracleLocationSchema).nullish().transform((value) => value ?? undefined),
  })
  .passthrough();
export const OracleListingPayloadSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            Limit: z.number().int().positive(),
            Offset: z.number().int().nonnegative(),
            TotalJobsCount: z.number().int().nonnegative(),
            requisitionList: z.array(z.unknown()),
          })
          .passthrough()
      )
      .min(1),
  })
  .passthrough();
const OracleDetailSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).transform(String),
    Title: z.string().min(1),
    PrimaryLocation: NullableStringSchema,
    ExternalDescriptionStr: NullableStringSchema,
    ExternalResponsibilitiesStr: NullableStringSchema,
    ExternalQualificationsStr: NullableStringSchema,
    ShortDescriptionStr: NullableStringSchema,
    WorkplaceType: NullableStringSchema,
    JobType: NullableStringSchema,
    JobFamily: NullableStringSchema,
    JobFunction: NullableStringSchema,
    Category: NullableStringSchema,
    Department: NullableStringSchema,
    Organization: NullableStringSchema,
    otherWorkLocations: z.array(OracleLocationSchema).nullish().transform((value) => value ?? undefined),
    secondaryLocations: z.array(OracleLocationSchema).nullish().transform((value) => value ?? undefined),
  })
  .passthrough();
export const OracleDetailPayloadSchema = z
  .object({ items: z.array(OracleDetailSchema) })
  .passthrough();

export type OracleListingRecord = z.infer<typeof OracleListingSchema>;
export type OracleDetailRecord = z.infer<typeof OracleDetailSchema>;

