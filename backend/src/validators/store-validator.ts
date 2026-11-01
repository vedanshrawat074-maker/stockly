import { z } from "zod";
import { objectIdSchema } from "./common-validator";

const timezoneSchema = z.string().trim().min(1).max(100).refine((timezone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}, "Provide a valid IANA timezone.");

export const createStoreSchema = z.object({
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().min(1).max(500),
  timezone: timezoneSchema,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
}).strict();

export const selectStoreSchema = z.object({
  storeId: objectIdSchema,
}).strict();
