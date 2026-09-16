import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  if (!env.DEV_FAKE_LOGIN) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "測試成員";
  const role = url.searchParams.get("admin") === "1" ? "admin" : "member";
  const db = await getDb();
  await db.prepare(`
    INSERT INTO members (id, line_user_id, display_name, role, last_login_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (line_user_id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role, last_login_at = excluded.last_login_at
  `).bind(newId(), `dev-${name}`, name, role, new Date().toISOString()).run();
  const row = await db.prepare("SELECT id FROM members WHERE line_user_id = ?").bind(`dev-${name}`).first<{ id: string }>();
  if (!row) return NextResponse.json({ error: "建立成員失敗" }, { status: 500 });
  (await cookies()).set(SESSION_COOKIE, await signSession(row.id, env.SESSION_SECRET), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return NextResponse.redirect(new URL("/", req.url));
}
