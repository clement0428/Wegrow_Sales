// Pushes a farm-booking event to the Sales CRM's sync endpoint (see
// wegrow-sales repo's proposed /api/farm-visitors/sync — not yet deployed,
// see docs/booking-calendar-implementation.md). Isolated from the outbox
// consumer for the same reason as LINE's buildPushRequest: testable without
// a network mock.
export type SalesSyncPayload = {
  eventType: "booking_created" | "booking_confirmed" | "booking_cancelled";
  bookingId: string;
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
