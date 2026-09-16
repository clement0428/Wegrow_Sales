"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { requireMember } from "@/lib/auth/current-member";
import type { Venue } from "@/lib/db/types";

export async function createVenue(name: string, address?: string): Promise<Venue> {
  const me = await requireMember();
  const v = z.object({ name: z.string().trim().min(1).max(60), address: z.string().trim().max(200).optional() }).parse({ name, address });
  const db = await getDb();
  const id = newId();
  await db.prepare("INSERT INTO venues (id, name, address, is_active, created_by) VALUES (?, ?, ?, 1, ?)")
    .bind(id, v.name, v.address || null, me.id).run();
  const row = await db.prepare("SELECT * FROM venues WHERE id=?").bind(id).first<Venue>();
  revalidatePath("/manage/venues");
  if (!row) throw new Error("建立地點失敗");
  return row;
}

export async function updateVenue(id: string, patch: { name?: string; address?: string | null; is_active?: boolean }): Promise<void> {
  await requireMember();
  const v = z.object({ name: z.string().trim().min(1).max(60).optional(), address: z.string().trim().max(200).nullable().optional(), is_active: z.boolean().optional() }).parse(patch);
  const db = await getDb();
  const fields: string[] = []; const values: (string | number | null)[] = [];
  if (v.name !== undefined) { fields.push("name=?"); values.push(v.name); }
  if (v.address !== undefined) { fields.push("address=?"); values.push(v.address); }
  if (v.is_active !== undefined) { fields.push("is_active=?"); values.push(v.is_active ? 1 : 0); }
  if (fields.length) {
    values.push(id);
    await db.prepare(`UPDATE venues SET ${fields.join(", ")} WHERE id=?`).bind(...values).run();
  }
  revalidatePath("/manage/venues");
}
