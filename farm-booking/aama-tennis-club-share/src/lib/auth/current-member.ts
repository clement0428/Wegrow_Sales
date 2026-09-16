import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { Member } from "@/lib/db/types";
import { SESSION_COOKIE, verifySession } from "./session";

export const getCurrentMember = cache(async (): Promise<Member | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const mid = await verifySession(token, env.SESSION_SECRET);
  if (!mid) return null;
  const row = await (await getDb()).prepare("SELECT * FROM members WHERE id = ?").bind(mid).first<Member>();
  return row ?? null;
});

export async function requireMember(): Promise<Member> {
  const m = await getCurrentMember();
  if (!m) redirect("/login");
  return m;
}

export const isAdmin = (m: Member) => m.role === "admin";

export async function requireAdmin(): Promise<Member> {
  const m = await requireMember();
  if (!isAdmin(m)) throw new Error("需要管理員權限");
  return m;
}
