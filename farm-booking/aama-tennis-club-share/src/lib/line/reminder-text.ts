// Pure message composition — no I/O, so it's directly unit-testable.
// 規格第6節：「對客戶的提醒包含日期時間、導航、聯絡方式與經核准的注意事項；
// 不可臆造地址、供餐菜單或採果承諾。」— only fields that actually exist on
// the booking/slot are interpolated; nothing invented.
const dateFmt = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "long", timeZone: "Asia/Taipei" });
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

export function composeDayBeforeReminderText(input: { experience: string; startsAt: string; endsAt: string; bookingNumber: string }): string {
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  return [
    "【WeGrow 農場參訪提醒】",
    `明天 ${dateFmt.format(start)} ${timeFmt.format(start)}–${timeFmt.format(end)}`,
    `行程：${input.experience}`,
    `預約編號：${input.bookingNumber}`,
    "地點：台南麻豆威果科技溫室（詳細導航請見官方 LINE 選單）",
    "如需異動請直接回覆本則訊息或聯繫官方 LINE。",
  ].join("\n");
}
