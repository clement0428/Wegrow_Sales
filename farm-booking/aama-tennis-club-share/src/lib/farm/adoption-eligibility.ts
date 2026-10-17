import "server-only";
import { env } from "@/lib/env";

// 跟wegrow-orbit-src的service-to-service橋接——farm-booking(LINE登入)跟Orbit企業
// 認養入口(email登入)是兩套完全不相通的身分系統。2026-10-17修正：原本直接拿客戶
// 自行填寫的email去問Orbit「這個email是不是認養客戶」——email只是查詢鍵，不是
// 身分證明，任何人填別人的email都能冒用別人的認養資格。改成nonce兌換：客戶必須
// 先在Orbit用真實帳密登入，Orbit才會核發這個nonce的資格；這裡只做「兌換一次」，
// 不接受任何客戶自稱的識別資訊。
//
// 2026-10-17二次修正：改呼叫POST /redeem（有副作用，不是GET /status那種唯讀
// 查詢），並帶上redemptionId（=farm-booking這端的idempotencyKey）——booking
// 建立失敗後用同一把idempotencyKey重試，Orbit會回同一個結果而不是拒絕，見
// wegrow-orbit-src的booking_eligibility.py module docstring。
export type AdoptionEligibilityResult =
  | { ok: true; eligible: true; sourceOrganizationId: string | null; sourceContractId: string | null }
  | { ok: true; eligible: false; reason: string }
  | { ok: false; error: string };

export async function redeemAdoptionEligibilityNonce(nonce: string, visitDateIso: string, redemptionId: string): Promise<AdoptionEligibilityResult> {
  const secret = env.FARM_BOOKING_ELIGIBILITY_SECRET;
  const baseUrl = env.ORBIT_API_BASE_URL;
  if (!secret || !baseUrl) {
    return { ok: false, error: "eligibility_service_not_configured" };
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/booking-eligibility/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ nonce, visit_date: visitDateIso, redemption_id: redemptionId }),
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
