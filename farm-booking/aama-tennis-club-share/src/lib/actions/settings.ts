"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { requireMember } from "@/lib/auth/current-member";
import { themeSchema, settingsSchema } from "@/lib/schemas/settings";
import { redirect } from "next/navigation";

export async function updateTheme(themeRaw: string): Promise<void> {
  const me = await requireMember();
  const theme = themeSchema.parse(themeRaw);
  const db = await getDb();
  await db.prepare("UPDATE members SET theme_preference=? WHERE id=?").bind(theme, me.id).run();
  revalidatePath("/", "layout");
}

export async function updateSettings(raw: unknown): Promise<void> {
  const me = await requireMember();
  const v = settingsSchema.parse(raw);
  const db = await getDb();
  const bc = v.bank_code?.trim() || null;
  const bn = v.bank_name?.trim() || null;
  const ba = v.bank_account?.trim() || null;
  const bh = v.bank_holder?.trim() || null;
  await db.prepare("UPDATE members SET bank_code=?, bank_name=?, bank_account=?, bank_holder=? WHERE id=?")
    .bind(bc, bn, ba, bh, me.id).run();
  revalidatePath("/settings");
}

export async function signOut(): Promise<never> {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.delete("tc_session");
  redirect("/login");
}
