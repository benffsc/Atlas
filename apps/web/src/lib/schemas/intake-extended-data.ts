/**
 * Zod schema for ops.requests.intake_extended_data JSONB column.
 *
 * These are intake submission fields that don't have dedicated columns
 * on ops.requests and are preserved as JSONB (MIG_2868).
 *
 * Uses .passthrough() so unknown keys from future intake versions
 * are preserved rather than stripped.
 *
 * @see sql/schema/v2/MIG_2868__preserve_intake_extended_data.sql
 */

import { z } from "zod";

export const IntakeExtendedDataSchema = z
  .object({
    best_trapping_time: z.string().nullish(),
    important_notes: z.string().nullish(),
    kitten_notes: z.string().nullish(),
    ownership_status: z.string().nullish(),
    observation_time_of_day: z.string().nullish(),
    feeding_duration: z.string().nullish(),
    cat_comes_inside: z.union([z.string(), z.boolean()]).nullish(),
    referral_source: z.string().nullish(),
    kitten_mixed_ages_description: z.string().nullish(),
    kitten_outcome: z.string().nullish(),
    foster_readiness: z.string().nullish(),
    kitten_urgency_factors: z.union([z.string(), z.array(z.string())]).nullish(),
    feeding_situation: z.string().nullish(),
  })
  .passthrough();

export type IntakeExtendedData = z.infer<typeof IntakeExtendedDataSchema>;

/**
 * Parse and validate intake_extended_data from the database.
 * Returns null for null/undefined input, typed data for valid JSONB.
 */
export function parseIntakeExtendedData(
  raw: Record<string, unknown> | null | undefined
): IntakeExtendedData | null {
  if (!raw) return null;
  const result = IntakeExtendedDataSchema.safeParse(raw);
  return result.success ? result.data : (raw as IntakeExtendedData);
}
