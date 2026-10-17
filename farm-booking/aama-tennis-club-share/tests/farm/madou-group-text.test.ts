import { describe, expect, it } from "vitest";
import {
  buildWorkCardActions, composeDailyDigestText, composeWorkCardCancelledText,
  composeWorkCardMessage, composeWorkCardRescheduledMessage, madouDigestDedupeKey, madouWorkCardDedupeKey,
  type WorkCardBooking,
} from "@/lib/line/madou-group-text";

const booking: WorkCardBooking = {
  bookingId: "B-1",
  bookingNumber: "WG-261016-ABC123",
  groupName: "測試團",
  experience: "草莓溫室參訪",
  startsAt: "2026-10-20T01:00:00.000Z", // 09:00 Taipei
  endsAt: "2026-10-20T03:00:00.000Z", // 11:00 Taipei
  adultCount: 10,
  childCount: 2,
  infantCount: 0,
  totalPeople: 12,
  plantCount: 3,
  mealCount: 5,
  vegetarianMealCount: 2,
};

describe("composeWorkCardMessage", () => {
  it("includes booking number, time, group name, and prep counts actually on the booking", () => {
    const msg = composeWorkCardMessage(booking, 1);
    expect(msg.type).toBe("template");
    expect(msg.template.text).toContain("WG-261016-ABC123");
    expect(msg.template.text).toContain("測試團");
    expect(msg.template.text).toContain("10");
    expect(msg.template.text).toContain("素食2份");
  });

  it("never invents a group name when none is set", () => {
    const noGroup = { ...booking, groupName: null };
    const msg = composeWorkCardMessage(noGroup, 1);
    expect(msg.template.text).not.toContain("團名");
  });

  it("omits meal/plant lines entirely when counts are zero, rather than printing '0份'", () => {
    const noExtras = { ...booking, plantCount: 0, mealCount: 0, vegetarianMealCount: 0 };
    const msg = composeWorkCardMessage(noExtras, 1);
    expect(msg.template.text).not.toContain("加購植栽");
    expect(msg.template.text).not.toContain("餐飲");
  });

  it("has exactly the three required postback actions with bookingId and the card's visit version wired through", () => {
    const actions = buildWorkCardActions("B-1", 3);
    expect(actions).toEqual([
      { type: "postback", label: "我接單", data: "action=claim&bookingId=B-1&v=3" },
      { type: "postback", label: "查看準備", data: "action=view_prep&bookingId=B-1&v=3" },
      { type: "postback", label: "回報問題", data: "action=report_issue&bookingId=B-1&v=3" },
    ]);
  });

  it("a card for a later visit_version carries a different claim postback than an earlier one — old cards must not silently validate", () => {
    const v1 = buildWorkCardActions("B-1", 1).find((a) => a.data.startsWith("action=claim"));
    const v2 = buildWorkCardActions("B-1", 2).find((a) => a.data.startsWith("action=claim"));
    expect(v1?.data).not.toBe(v2?.data);
  });
});

describe("composeWorkCardRescheduledMessage / composeWorkCardCancelledText", () => {
  it("states both the old and new time for a reschedule, voids the old claim, and issues a fresh claim button with the new visit version", () => {
    const msg = composeWorkCardRescheduledMessage(booking, "2026-10-18T01:00:00.000Z", 2);
    expect(msg.type).toBe("template");
    expect(msg.template.text).toContain("WG-261016-ABC123");
    expect(msg.template.text).toContain("已失效");
    const claimAction = msg.template.actions.find((a) => a.data.startsWith("action=claim"));
    expect(claimAction?.data).toBe("action=claim&bookingId=B-1&v=2");
  });

  it("cancellation text tells staff to stop prep, not just 'cancelled'", () => {
    const text = composeWorkCardCancelledText(booking);
    expect(text).toContain("已取消");
    expect(text).toContain("停止相關備料");
  });
});

describe("composeDailyDigestText", () => {
  it("reports an empty day honestly rather than omitting the message", () => {
    expect(composeDailyDigestText("2026-10-20", [])).toContain("無預約場次");
  });

  it("flags unclaimed bookings distinctly from claimed ones", () => {
    const text = composeDailyDigestText("2026-10-20", [
      { bookingNumber: "WG-1", groupName: null, startsAt: "2026-10-20T01:00:00.000Z", totalPeople: 10, claimedByName: "小明" },
      { bookingNumber: "WG-2", groupName: "B團", startsAt: "2026-10-20T03:00:00.000Z", totalPeople: 5, claimedByName: null },
    ]);
    expect(text).toContain("已接單：小明");
    expect(text).toContain("⚠️尚未接單");
    expect(text).toContain("尚有 1 團未接單");
    expect(text).toContain("共2團，合計15人");
  });
});

describe("dedupe keys", () => {
  it("work card dedupe key is versioned so a reschedule doesn't collide with the old key", () => {
    expect(madouWorkCardDedupeKey("B-1", 1, "confirmed")).toBe("B-1:madou:1:work_card:confirmed");
    expect(madouWorkCardDedupeKey("B-1", 2, "confirmed")).not.toBe(madouWorkCardDedupeKey("B-1", 1, "confirmed"));
    expect(madouWorkCardDedupeKey("B-1", 1, "cancelled")).not.toBe(madouWorkCardDedupeKey("B-1", 1, "confirmed"));
  });

  it("digest dedupe key is scoped to the calendar date", () => {
    expect(madouDigestDedupeKey("2026-10-20")).toBe("madou:digest:2026-10-20");
    expect(madouDigestDedupeKey("2026-10-21")).not.toBe(madouDigestDedupeKey("2026-10-20"));
  });
});
