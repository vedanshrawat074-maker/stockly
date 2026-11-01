import { z } from "zod";

const emailSchema = z.string().trim().pipe(z.email().max(254)).transform((email) => email.toLowerCase());
const passwordSchema = z.string().min(12).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: emailSchema,
  password: passwordSchema,
}).strict();

export const loginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).strict();
