import { z } from "zod";

export const clothingAnalyticsQuerySchema = z
  .object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .strict()
  .superRefine((query, context) => {
    const start = new Date(`${query.startDate}T00:00:00.000Z`);
    const end = new Date(`${query.endDate}T00:00:00.000Z`);
    const dayCount = (end.getTime() - start.getTime()) / 86_400_000 + 1;

    if (dayCount < 1) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "endDate must be on or after startDate.",
      });
    } else if (dayCount > 366) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Date range must not exceed 366 calendar days.",
      });
    }
  });

export type ClothingAnalyticsQuery = z.infer<typeof clothingAnalyticsQuerySchema>;
