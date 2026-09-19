import { describe, expect, it } from "vitest";
import { buildPushRequest, nextAttemptDelayMinutes, MAX_SEND_ATTEMPTS } from "@/lib/line/messaging";
import { composeDayBeforeReminderText } from "@/lib/line/reminder-text";
import { buildSyncRequest } from "@/lib/sales/sync-client";

describe("buildPushRequest", () => {
  it("targets the real LINE push endpoint with a bearer token, retry key, and the right body shape", () => {
    const { url, init } = buildPushRequest("tok_123", "U_abc", [{ type: "text", text: "hi" }], "retry-key-1");
    expect(url).toBe("https://api.line.me/v2/bot/message/push");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_123");
    expect(headers["X-Line-Retry-Key"]).toBe("retry-key-1");
    expect(JSON.parse(init.body as string)).toEqual({ to: "U_abc", messages: [{ type: "text", text: "hi" }] });
  });
});

describe("nextAttemptDelayMinutes", () => {
  it("escalates backoff with each attempt", () => {
    expect(nextAttemptDelayMinutes(0)).toBe(5);
    expect(nextAttemptDelayMinutes(1)).toBe(15);
    expect(nextAttemptDelayMinutes(2)).toBe(60);
  });

  it("caps out rather than growing unbounded", () => {
    const capped = nextAttemptDelayMinutes(1000);
    expect(capped).toBe(nextAttemptDelayMinutes(4));
    expect(capped).toBeLessThanOrEqual(720);
  });

  it("MAX_SEND_ATTEMPTS is reached before the backoff table runs out, so it always resolves to a fixed delay", () => {
    expect(nextAttemptDelayMinutes(MAX_SEND_ATTEMPTS)).toBeGreaterThan(0);
  });
});

describe("buildSyncRequest", () => {
  it("targets the configured URL with the sync key header and full event payload", () => {
    const { url, init } = buildSyncRequest("https://sales.example/api/farm-visitors/sync", "key_abc", {
      eventId: "evt-1", schemaVersion: 1, eventType: "booking_created", occurredAt: "2026-09-19T00:00:00.000Z",
      bookingId: "b1", bookingVersion: 1, bookingNumber: "WG-1", contactName: "測試",
      contactPhone: "0912345678", groupName: "", totalPeople: 3, startsAt: "2026-10-01T14:00:00+08:00", experience: "科技溫室農場參訪",
    });
    expect(url).toBe("https://sales.example/api/farm-visitors/sync");
    expect((init.headers as Record<string, string>)["X-Sales-Sync-Key"]).toBe("key_abc");
    const body = JSON.parse(init.body as string);
    expect(body.bookingNumber).toBe("WG-1");
    expect(body.eventId).toBe("evt-1");
    expect(body.bookingVersion).toBe(1);
    // PII policy: must never include a LINE user id, session token, or payment amount.
    expect(body).not.toHaveProperty("lineUserId");
    expect(body).not.toHaveProperty("amountTwd");
  });
});

describe("composeDayBeforeReminderText", () => {
  it("includes the booking number, experience name, and formatted date/time — nothing invented", () => {
    const text = composeDayBeforeReminderText({
      experience: "科技溫室農場參訪",
      startsAt: "2026-10-01T14:00:00+08:00",
      endsAt: "2026-10-01T18:00:00+08:00",
      bookingNumber: "WG-261001-ABC123",
    });
    expect(text).toContain("科技溫室農場參訪");
    expect(text).toContain("WG-261001-ABC123");
    expect(text).toContain("14:00");
    expect(text).toContain("18:00");
    // Explicitly must not claim a real address or meal menu it wasn't given.
    expect(text).not.toMatch(/麻豆區.+路\d+號/);
  });
});
