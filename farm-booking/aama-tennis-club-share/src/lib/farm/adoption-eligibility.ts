import "server-only";
import { env } from "@/lib/env";

// 跟wegrow-orbit-src的service-to-service橋接——farm-booking(LINE登入)跟Orbit企業
// 認養入口(email登入)是兩套完全不相通的身分系統，沒有既有連結，用email當橋接鍵
// （見wegrow-orbit-src commit 981f69e的設計說明）。這裡只處理「問」，不處理UI，
// 呼叫端(booking route)決定查不到/服務掛掉時怎麼辦——這支函式本身對「不合格」跟
// 「查詢失敗」兩種情況回傳不同的discriminated union，不能混成同一種false。
export type AdoptionEligibilityResult =
  | { ok: true; eligible: true; sourceOrganizationId: string | null; sourceContractId: string | null }
  | { ok: true; eligible: false; reason: string }
  | { ok: false; error: string };

export async function checkAdoptionVisitEligibility(email: string, visitDateIso: string): Promise<AdoptionEligibilityResult> {
  const secret = env.FARM_BOOKING_ELIGIBILITY_SECRET;
  const baseUrl = env.ORBIT_API_BASE_URL;
  if (!secret || !baseUrl) {
    return { ok: false, error: "eligibility_service_not_configured" };
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/booking-eligibility/adoption-visit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ email, visit_date: visitDateIso }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network_error" };
  }
  if (!response.ok) {
    return { ok: false, error: `eligibility_service_http_${response.status}` };
  }
  const body = (await response.json()) as { eligible: boolean; reason: string; source_organization_id: string | null; source_contract_id: string | null };
  if (body.eligible) {
    return { ok: true, eligible: true, sourceOrganizationId: body.source_organization_id, sourceContractId: body.source_contract_id };
  }
  return { ok: true, eligible: false, reason: body.reason };
}
