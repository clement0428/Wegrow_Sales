import { z } from "zod";

export const themeSchema = z.enum(["clay", "hard", "grass"]);
export type ThemePref = z.infer<typeof themeSchema>;

export const settingsSchema = z.object({
  bank_code: z.string().trim().max(10).optional().or(z.literal("")),
  bank_name: z.string().trim().max(60).optional().or(z.literal("")),
  bank_account: z.string().trim().max(30).optional().or(z.literal("")),
  bank_holder: z.string().trim().max(30).optional().or(z.literal("")),
});
export type SettingsInput = z.infer<typeof settingsSchema>;
