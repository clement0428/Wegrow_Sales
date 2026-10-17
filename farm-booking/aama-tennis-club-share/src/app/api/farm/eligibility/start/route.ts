import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import { ELIGIBILITY_SESSION_COOKIE, ELIGIBILITY_SESSION_MAX_AGE_SECONDS, startEligibilitySession } from "@/lib/farm/eligibility-session";
import { taipeiDateIso } from "@/lib/farm/taipei-date";

const bodySchema = z.object({
  slotId: z.string().min(1).max(100),
  // 只是為了讓客戶從Orbit登入導回來時，頁面能復原這幾個欄位（全新page load，
  // React state不會留著）——不影響資格核對本身，核對只看nonce+visit_date。
  adultCount: z.number().int().min(1).max(50).default(2),
  childCount: z.number().int().min(0).max(50).default(0),
  infantCount: z.number().int().min(0).max(50).default(0),
});

// 認養客戶點「免費參訪」時，前端先呼叫這支API拿一個本次請求專用的nonce，再把
// 瀏覽器導去Orbit真實登入——nonce本身不含任何身分資訊，只是讓farm-booking跟
// Orbit兩邊在稍後各自核對同一次請求用的交換憑證（見adoption-eligibility.ts、
// wegrow-orbit-src的booking_eligibility router）。同時設一個只存在HttpOnly
// cookie、從不出現在任何URL的session token——避免nonce字串（會出現在轉址URL/
// Referer/伺服器日誌）被攔截後拿去別的瀏覽器兌換。
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "缺少選擇的時段" }, { status: 400 });
  }
  const db = await getDb();
  const slot = await db
    .prepare("SELECT starts_at FROM farm_slots WHERE id = ? LIMIT 1")
    .bind(parsed.data.slotId)
    .first<{ starts_at: string }>();
  if (!slot) {
    return Response.json({ error: "找不到這個時段，請重新選擇。" }, { status: 400 });
  }
  const visitDateIso = taipeiDateIso(slot.starts_at);

  let session: { nonce: string; sessionToken: string; expiresAt: string };
  try {
    session = await startEligibilitySession(db, visitDateIso);
  } catch {
    // migration尚未套用（farm_eligibility_requests還不存在）或其他D1問題——回受控
    // 503，不把D1的原始錯誤訊息（例如"no such table"）直接丟給客戶看。
    return Response.json(
      { error: "免費資格驗證暫時無法使用，請改用一般付費預約，或聯絡威果官方 LINE 協助確認。", code: "eligibility_feature_unavailable" },
      { status: 503 },
    );
  }
  const { nonce, sessionToken, expiresAt } = session;

  const redirectUrl = new URL(env.ORBIT_CUSTOMER_PORTAL_URL);
  redirectUrl.searchParams.set("booking_eligibility_nonce", nonce);
  redirectUrl.searchParams.set("booking_visit_date", visitDateIso);
  // slotId要帶回booking_return_url——瀏覽器離開去Orbit登入再導回來是全新的
  // page load，React state（含剛選的slotId）不會留著，前端得從URL復原選擇。
  const returnUrl = new URL(`${new URL(request.url).origin}/booking`);
  returnUrl.searchParams.set("eligibilityNonce", nonce);
  returnUrl.searchParams.set("eligibilityExpiresAt", expiresAt);
  returnUrl.searchParams.set("slotId", parsed.data.slotId);
  returnUrl.searchParams.set("adultCount", String(parsed.data.adultCount));
  returnUrl.searchParams.set("childCount", String(parsed.data.childCount));
  returnUrl.searchParams.set("infantCount", String(parsed.data.infantCount));
  redirectUrl.searchParams.set("booking_return_url", returnUrl.toString());

  (await cookies()).set(ELIGIBILITY_SESSION_COOKIE, sessionToken, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/",
    maxAge: ELIGIBILITY_SESSION_MAX_AGE_SECONDS,
  });

  return Response.json({ nonce, expiresAt, orbitRedirectUrl: redirectUrl.toString() });
}
