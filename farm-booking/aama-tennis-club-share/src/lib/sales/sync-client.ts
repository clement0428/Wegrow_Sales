// Pushes a farm-booking event to the Sales CRM's sync endpoint (see
// wegrow-sales repo's POST /api/farm-visitors/sync — code written and
// tested there, NOT yet deployed to that separate production system; see
// docs/booking-calendar-implementation.md and project memory).
//
// API contract (v1):
//   POST <SALES_SYNC_API_URL>
//   Header: X-Sales-Sync-Key: <SALES_SYNC_API_KEY>
//   Body: SalesSyncPayload (below), Content-Type application/json
//   Response: 2xx = accepted (idempotent on eventId — a duplicate eventId
//     must return 2xx with a "duplicate" marker, not create a second
//     record); 400 = invalid payload (permanent, don't retry); 401 =
//     bad/missing key (permanent, don't retry); 5xx = transient, retry.
//
// Explicit PII policy: this payload is a MINIMIZED booking projection.
// Included: contact name/phone (Sales genuinely needs these to do
// anything — that's the entire point of "Sales以booking_id關聯客戶").
// Excluded, deliberately, forever: full LINE profile data, any session/
// identity token, full dietary notes, payment proof/amounts. If a future
// change needs more fields, it needs its own explicit sign-off, not a
// silent payload expansion here.
export type SalesSyncEventType = "booking_created" | "booking_confirmed" | "booking_cancelled";

export type SalesSyncPayload = {
  eventId: string; // = the outbox row's own id — globally unique, receiver's dedupe key
  schemaVersion: 1;
  eventType: SalesSyncEventType;
  occurredAt: string; // ISO — when this event was queued on the farm-booking side
  bookingId: string;
  bookingVersion: number; // monotonic per booking; receiver must not let an older version overwrite a newer projection
  bookingNumber: string;
  contactName: string;
  contactPhone: string;
  groupName: string;
  totalPeople: number;
  startsAt: string;
  experience: string;
};

export function buildSyncRequest(apiUrl: string, apiKey: string, payload: SalesSyncPayload) {
  return {
    url: apiUrl,
    init: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sales-Sync-Key": apiKey,
      },
      body: JSON.stringify(payload),
    } satisfies RequestInit,
  };
}

export type SyncResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function sendSalesSync(apiUrl: string, apiKey: string, payload: SalesSyncPayload): Promise<SyncResult> {
  const { url, init } = buildSyncRequest(apiUrl, apiKey, payload);
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : "network_error" };
  }
  if (response.ok) return { ok: true };
  const body = await response.text().catch(() => "");
  return { ok: false, status: response.status, error: body.slice(0, 500) };
}
