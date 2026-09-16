import { z } from "zod";
import { taipeiISO } from "@/lib/time";

export const eventInputSchema = z
  .object({
    title: z.string().trim().min(1, "請填場次名稱").max(60),
    event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start_time: z.string().regex(/^\d{2}:\d{2}$/),
    end_time: z.string().regex(/^\d{2}:\d{2}$/),
    registration_deadline: z.string().min(1), // "YYYY-MM-DDTHH:mm"
    venue_id: z.string().min(1, "請選地點"),
    capacity: z.coerce.number().int().min(1).max(100),
    estimated_total: z.coerce.number().int().min(0).optional().or(z.literal("").transform(() => undefined)),
    note: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.end_time > v.start_time, { message: "結束時間必須晚於開始時間", path: ["end_time"] })
  .refine(
    (v) => new Date(`${v.registration_deadline}:00+08:00`) < new Date(taipeiISO(v.event_date, v.start_time)),
    { message: "退出截止時間必須早於活動開始", path: ["registration_deadline"] },
  );

export type EventInput = z.infer<typeof eventInputSchema>;
