import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyLineIdToken } from "@/lib/auth/line";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const { idToken } = (await req.json().catch(() => ({}))) as { idToken?: string };
  if (!idToken) return NextResponse.json({ error: "缺少 idToken" }, { status: 400 });
  let profile;
  try {
    profile = await verifyLineIdToken(idToken, env.LINE_CHANNEL_ID);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const db = await getDb();
  const id = newId();
  const nowIso = new Date().toISOString();
  await db.prepare(`
    INSERT INTO members (id, line_user_id, display_name, picture_url, last_login_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (line_user_id) DO UPDATE SET display_name = excluded.display_name, picture_url = excluded.picture_url, last_login_at = excluded.last_login_at
  `).bind(id, profile.sub, profile.name, profile.picture, nowIso).run();
  const row = await db.prepare("SELECT id FROM members WHERE line_user_id = ?").bind(profile.sub).first<{ id: string }>();
  if (!row) return NextResponse.json({ error: "建立成員失敗" }, { status: 500 });
  const token = await signSession(row.id, env.SESSION_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return NextResponse.json({ ok: true });
}
