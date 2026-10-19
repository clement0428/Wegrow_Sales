// 麻豆現場群訊息組裝——純函式，不做I/O（同 reminder-text.ts 風格）。
// 規格第3-4節：工作卡只能帶入預約既有欄位，不可臆造備料/餐飲內容；
// 「我接單」等按鈕是postback，不是要求員工手動輸入指令。
import type { LineButtonsTemplateMessage } from "./messaging";

const dateFmt = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "long", timeZone: "Asia/Taipei" });
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

export type WorkCardBooking = {
  bookingId: string;
  bookingNumber: string;
  groupName: string | null;
  experience: string;
  startsAt: string;
  endsAt: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  totalPeople: number;
  plantCount: number;
  mealCount: number;
  vegetarianMealCount: number;
};

function prepSummaryLines(b: WorkCardBooking): string[] {
  const lines = [`人數：成人${b.adultCount}／兒童${b.childCount}／嬰幼兒${b.infantCount}（共${b.totalPeople}人）`];
  if (b.plantCount > 0) lines.push(`加購植栽：${b.plantCount}份`);
  if (b.mealCount > 0) {
    lines.push(b.vegetarianMealCount > 0 ? `現場餐飲：${b.mealCount}份（其中素食${b.vegetarianMealCount}份）` : `現場餐飲：${b.mealCount}份`);
  }
  return lines;
}

/**
 * Postback data for claim/view-prep/report-issue — kept short, parsed by the webhook.
 * visitVersion is the version current when THIS card was composed — the webhook's
 * claim handler rejects a claim attempt whose `v` no longer matches the booking's
 * current visit_version (a stale card from before a reschedule), so an old card
 * can never silently claim a booking it no longer accurately describes.
 */
export function buildWorkCardActions(bookingId: string, visitVersion: number): LineButtonsTemplateMessage["template"]["actions"] {
  return [
    { type: "postback", label: "我接單", data: `action=claim&bookingId=${bookingId}&v=${visitVersion}` },
    { type: "postback", label: "查看準備", data: `action=view_prep&bookingId=${bookingId}&v=${visitVersion}` },
    { type: "postback", label: "回報問題", data: `action=report_issue&bookingId=${bookingId}&v=${visitVersion}` },
  ];
}

// "查看準備" postback reply — same underlying fields as the work card, just as a
// plain reply instead of a new buttons template (replying with another buttons
// template would just re-show the same three actions pointlessly).
export function composePrepDetailText(b: WorkCardBooking): string {
  const start = new Date(b.startsAt);
  const end = new Date(b.endsAt);
  return [
    `${b.bookingNumber}｜${dateFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}`,
    `行程：${b.experience}`,
    b.groupName ? `團名：${b.groupName}` : null,
    ...prepSummaryLines(b),
  ].filter((line): line is string => Boolean(line)).join("\n");
}

// 2026-10-17審查要求：待接待(requested)預約一建立就要發工作卡，不能等到admin
// 明確按confirm才發——否則就是「先確認才發卡」的循環。跟composeWorkCardMessage
// (已confirmed)文案刻意不同，避免現場誤以為這團已經確定，實際上還沒人接待。
export function composeWorkCardPendingMessage(b: WorkCardBooking, visitVersion: number): LineButtonsTemplateMessage {
  const start = new Date(b.startsAt);
  const end = new Date(b.endsAt);
  const text = [
    `待接待預約 ${b.bookingNumber}`,
    `${dateFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}｜${b.experience}`,
    b.groupName ? `團名：${b.groupName}` : null,
    ...prepSummaryLines(b),
    "尚未有人接待，請按「我來接待」確認。",
  ].filter((line): line is string => Boolean(line)).join("\n");
  return {
    type: "template",
    altText: `待接待預約 ${b.bookingNumber}`,
    template: { type: "buttons", text: text.slice(0, 160), actions: buildWorkCardActions(b.bookingId, visitVersion) },
  };
}

export function composeWorkCardMessage(b: WorkCardBooking, visitVersion: number): LineButtonsTemplateMessage {
  const start = new Date(b.startsAt);
  const end = new Date(b.endsAt);
  const text = [
    `新預約 ${b.bookingNumber}`,
    `${dateFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}｜${b.experience}`,
    b.groupName ? `團名：${b.groupName}` : null,
    ...prepSummaryLines(b),
  ].filter((line): line is string => Boolean(line)).join("\n");
  return {
    type: "template",
    altText: `新預約工作卡 ${b.bookingNumber}`,
    template: { type: "buttons", text: text.slice(0, 160), actions: buildWorkCardActions(b.bookingId, visitVersion) },
  };
}

// 改期後必須發「新」一組按鈕（帶新visitVersion），不能只發文字叫現場自己回頭找
// 舊卡——舊卡的按鈕本來就該失效（claim.ts的版本檢查），但現場仍需要一個「可以
// 按」的按鈕來接新時段，否則等於沒有入口可以重新接單。
export function composeWorkCardRescheduledMessage(b: WorkCardBooking, oldStartsAt: string, visitVersion: number): LineButtonsTemplateMessage {
  const oldStart = new Date(oldStartsAt);
  const newStart = new Date(b.startsAt);
  const text = [
    `預約 ${b.bookingNumber} 已改期`,
    `原訂 ${dateFmt.format(oldStart)} ${timeFmt.format(oldStart)} → 新時段 ${dateFmt.format(newStart)} ${timeFmt.format(newStart)}`,
    "原工作卡按鈕已失效，請用此訊息重新「我接單」。",
  ].join("\n");
  return {
    type: "template",
    altText: `預約改期 ${b.bookingNumber}`,
    template: { type: "buttons", text: text.slice(0, 160), actions: buildWorkCardActions(b.bookingId, visitVersion) },
  };
}

// 未接單升級：門檻分鐘數由後台設定（settings.ts），沒設定時這支函式根本不會
// 被呼叫（見unclaimed-escalation.ts）。重發同一組按鈕，不是只貼一句提醒文字——
// 現場看到升級訊息要能直接按，不用回頭找原卡。
export function composeUnclaimedEscalationMessage(b: WorkCardBooking, visitVersion: number, waitingMinutes: number): LineButtonsTemplateMessage {
  const start = new Date(b.startsAt);
  const text = [
    `⚠️ 已超時未接單（等待${waitingMinutes}分鐘）`,
    `${b.bookingNumber}｜${dateFmt.format(start)} ${timeFmt.format(start)}｜${b.experience}`,
  ].join("\n");
  return {
    type: "template",
    altText: `未接單提醒 ${b.bookingNumber}`,
    template: { type: "buttons", text: text.slice(0, 160), actions: buildWorkCardActions(b.bookingId, visitVersion) },
  };
}

export function composeWorkCardCancelledText(b: Pick<WorkCardBooking, "bookingNumber" | "startsAt">): string {
  const start = new Date(b.startsAt);
  return [
    `預約 ${b.bookingNumber}（${dateFmt.format(start)} ${timeFmt.format(start)}）已取消`,
    "請停止相關備料準備；原認領與提醒已作廢。",
  ].join("\n");
}

export type DailyDigestBooking = {
  bookingNumber: string;
  groupName: string | null;
  startsAt: string;
  totalPeople: number;
  claimedByName: string | null;
};

export function composeDailyDigestText(dateIso: string, bookings: DailyDigestBooking[]): string {
  const dateLabel = dateFmt.format(new Date(dateIso));
  if (bookings.length === 0) return `【明日(${dateLabel})現場彙整】無預約場次。`;
  const totalPeople = bookings.reduce((sum, b) => sum + b.totalPeople, 0);
  const unclaimed = bookings.filter((b) => !b.claimedByName);
  const lines = [
    `【明日(${dateLabel})現場彙整】共${bookings.length}團，合計${totalPeople}人`,
    ...bookings.map((b) => {
      const time = timeFmt.format(new Date(b.startsAt));
      const who = b.claimedByName ? `已接單：${b.claimedByName}` : "⚠️尚未接單";
      return `${time} ${b.bookingNumber}${b.groupName ? `（${b.groupName}）` : ""}｜${b.totalPeople}人｜${who}`;
    }),
  ];
  if (unclaimed.length > 0) lines.push(`尚有 ${unclaimed.length} 團未接單，請主責確認。`);
  return lines.join("\n");
}

export type WorkCardEventKind = "pending" | "confirmed" | "rescheduled" | "cancelled";

export function madouWorkCardDedupeKey(bookingId: string, visitVersion: number, eventKind: WorkCardEventKind): string {
  return `${bookingId}:madou:${visitVersion}:work_card:${eventKind}`;
}

// One digest attempt per calendar date — INSERT OR IGNORE on this key means the
// first producer call for a given date wins; content is a best-effort snapshot
// as of whenever that first call actually ran, same as any other queued
// notification (never re-composed from live data at send time).
export function madouDigestDedupeKey(dateIso: string): string {
  return `madou:digest:${dateIso}`;
}
