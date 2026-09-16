import Link from "next/link";
import { Check, X } from "lucide-react";
import { requireMember } from "@/lib/auth/current-member";
import HeroBanner from "@/components/HeroBanner";
import { listMyRegistrations } from "@/lib/db/queries";
import { isPast } from "@/lib/domain/event-status";
import { dateParts, hm } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const me = await requireMember();
  const now = new Date();
  const regs = (await listMyRegistrations(me.id)).filter((r) => r.event.status !== "cancelled");
  const unpaid = regs.filter((r) => r.event.status === "settled" && r.attended === 1 && !r.paid_at);
  const total = unpaid.reduce((s, r) => s + (r.amount_due ?? 0), 0);
  const upcomingConfirmed = regs.filter((r) => !isPast(r.event, now) && r.status === "confirmed")
    .sort((a, b) => a.event.event_date.localeCompare(b.event.event_date));
  const upcomingWaitlisted = regs.filter((r) => !isPast(r.event, now) && r.status === "waitlisted")
    .sort((a, b) => a.event.event_date.localeCompare(b.event.event_date));
  const history = regs.filter((r) => isPast(r.event, now)).sort((a, b) => b.event.event_date.localeCompare(a.event.event_date));

  return (
    <div className="px-2">
      <div className="pt-1 pb-3">
        <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[var(--primary)]">我的大滿貫</div>
      </div>

      {/* Owed hero — same banner component as the events page */}
      <HeroBanner>
        <div className="text-[11.5px] font-semibold opacity-90">目前待付款</div>
        <div className="font-display tabular text-[44px] font-extrabold leading-none mt-1.5">${total}</div>
        <div className="text-[12px] opacity-90 mt-2">
          {total === 0 ? "乾淨如新球場 ✨ 沒有未付款項" : `${unpaid.length} 場待付`}
        </div>
      </HeroBanner>

      {unpaid.length > 0 && (
        <div className="mt-3 space-y-2">
          {unpaid.map((r) => {
            const d = dateParts(r.event.event_date);
            return (
              <Link href={`/?event=${r.event.id}`} scroll={false} key={r.id} className="block bg-[var(--surface)] rounded-[14px] px-3 py-2.5 shadow-[var(--shadow-1)] flex items-center gap-3">
                <div className="w-11 h-11 rounded-[12px] flex flex-col items-center justify-center" style={{ background: "var(--court-soft)", color: "var(--court)" }}>
                  <div className="tabular text-[16px] font-extrabold leading-none">{d.day}</div>
                  <div className="text-[8.5px] font-bold tracking-[.06em] mt-0.5">{r.event.event_date.slice(5,7).replace(/^0/, "")}月</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-semibold truncate">{r.event.title}</div>
                  <div className="text-[11px] text-[var(--ink-3)] mt-0.5">應付 <span className="font-bold text-[var(--primary)] tabular">${r.amount_due}</span></div>
                </div>
                <span className="bg-[var(--primary-soft)] text-[var(--primary)] px-2.5 py-1 rounded-full text-[11px] font-bold whitespace-nowrap">待付</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Upcoming */}
      <div className="mt-5 text-[13px] font-bold text-[var(--ink-2)] tracking-[.06em]">即將參加 {upcomingConfirmed.length + upcomingWaitlisted.length}</div>
      <div className="mt-2 space-y-3">
        {[...upcomingConfirmed, ...upcomingWaitlisted].map((r) => {
          const d = dateParts(r.event.event_date);
          const isWait = r.status === "waitlisted";
          return (
            <Link href={`/?event=${r.event.id}`} scroll={false} key={r.id} className="block bg-[var(--surface)] rounded-[18px] p-3.5 shadow-[var(--shadow-1)] flex items-center gap-3">
              <div className="w-11 h-11 rounded-[12px] flex flex-col items-center justify-center" style={{ background: "var(--court-soft)", color: "var(--court)" }}>
                <div className="tabular text-[16px] font-extrabold leading-none">{d.day}</div>
                <div className="text-[8.5px] font-bold tracking-[.06em] mt-0.5">{r.event.event_date.slice(5,7).replace(/^0/, "")}月</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold truncate">{r.event.title}</div>
                <div className="text-[11.5px] text-[var(--ink-2)] mt-0.5">{hm(r.event.start_time)} · {r.event.venue.name}</div>
              </div>
              {isWait ? (
                <span className="bg-[var(--surface-2)] text-[var(--ink-2)] px-2 py-[3px] rounded-full text-[10px] font-bold whitespace-nowrap">候補中</span>
              ) : (
                <span className="bg-[var(--accent)] text-[var(--accent-ink)] px-2 py-[3px] rounded-full text-[10px] font-bold whitespace-nowrap">已接龍</span>
              )}
            </Link>
          );
        })}
        {upcomingConfirmed.length + upcomingWaitlisted.length === 0 && (
          <p className="py-6 text-center text-[var(--ink-3)] text-sm">還沒接龍任何場次，去「場次」找一場吧</p>
        )}
      </div>

      {/* History */}
      <div className="mt-5 text-[13px] font-bold text-[var(--ink-2)] tracking-[.06em]">歷史紀錄 {history.length}</div>
      <div className="mt-2 space-y-3">
        {history.map((r) => {
          const paid = r.paid_at !== null && r.paid_at !== undefined;
          const wasThere = r.attended === 1;
          const settled = r.event.status === "settled";
          const rightIcon = !settled ? (
            <span className="text-[10.5px] text-[var(--ink-3)] font-medium">待結算</span>
          ) : !wasThere ? (
            <span className="text-[10.5px] text-[var(--ink-3)] font-medium">未出席</span>
          ) : paid ? (
            <Check className="w-[18px] h-[18px]" style={{ color: "var(--success)" }} strokeWidth={2.4} />
          ) : (
            <X className="w-[18px] h-[18px]" style={{ color: "var(--danger)" }} strokeWidth={2.4} />
          );
          return (
            <Link href={`/?event=${r.event.id}`} scroll={false} key={r.id} className="block bg-[var(--surface)] rounded-[14px] px-3.5 py-3 shadow-[var(--shadow-1)] flex items-center gap-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold truncate">
                  {r.event.event_date.slice(5).replace("-", "/")} {r.event.title}
                </div>
                <div className="text-[11px] text-[var(--ink-3)] mt-0.5">
                  {settled && wasThere ? `$${r.amount_due} · ${paid ? "已付" : "待付"}` : (settled ? "未出席" : "待結算")}
                </div>
              </div>
              {rightIcon}
            </Link>
          );
        })}
        {history.length === 0 && <p className="py-4 text-center text-[var(--ink-3)] text-sm">尚無歷史紀錄</p>}
      </div>
    </div>
  );
}
