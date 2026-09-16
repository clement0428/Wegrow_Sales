"use client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Copy, Check, MapPin, Calendar as CalendarIcon, CalendarPlus, Navigation, Pencil } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useTransition } from "react";
import type { EventWithCounts, RegistrationWithMember } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import { dateParts, formatTaipei, hm } from "@/lib/time";
import { register, cancel } from "@/lib/actions/registrations";
import Avatar from "./Avatar";

type Props = {
  event: EventWithCounts;
  regs: RegistrationWithMember[];
  meId: string;
  canManage: boolean;
};

export default function EventQuickSheet({ event, regs, meId, canManage }: Props) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  // Drag-the-handle-down to dismiss
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ startY: 0, active: false });
  const [entered, setEntered] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const onDragStart = (e: React.PointerEvent) => {
    dragRef.current = { startY: e.clientY, active: true };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    setDragY(Math.max(0, e.clientY - dragRef.current.startY));
  };
  const onDragEnd = () => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setDragging(false);
    const h = sheetRef.current?.getBoundingClientRect().height ?? 600;
    if (dragY > Math.min(150, h * 0.22)) close();
    else setDragY(0);
  };

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
     
  }, []);

  const close = () => router.push("/", { scroll: false });

  const now = new Date();
  const status = deriveEventStatus(event, now);
  const mine = regs.find((r) => r.member_id === meId) ?? null;
  const d = dateParts(event.event_date);
  const full = event.confirmed_count >= event.capacity;
  const perPerson = event.estimated_total && event.capacity ? Math.ceil(event.estimated_total / event.capacity) : null;
  const pct = Math.min(100, (event.confirmed_count / Math.max(1, event.capacity)) * 100);

  const gcalDate = (t: string) => `${event.event_date.replace(/-/g, "")}T${hm(t).replace(":", "")}00`;
  const calendarUrl = `https://www.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${gcalDate(event.start_time)}/${gcalDate(event.end_time)}&location=${encodeURIComponent(event.venue.name)}&details=${encodeURIComponent(event.note ?? "")}&ctz=Asia/Taipei`;
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue.name)}`;
  const liffId = typeof process !== "undefined" ? process.env.NEXT_PUBLIC_LIFF_ID : undefined;
  const shareUrl = liffId
    ? `https://liff.line.me/${liffId}/events/${event.id}`
    : (mounted ? `${window.location.origin}/events/${event.id}` : `/events/${event.id}`);

  const confirmed = regs.filter((r) => r.status === "confirmed").sort((a, b) => a.seat_no - b.seat_no);
  const waitlisted = regs.filter((r) => r.status === "waitlisted").sort((a, b) => a.seat_no - b.seat_no);

  // Split confirmed into two teams (left/right of net)
  const half = Math.ceil(confirmed.length / 2);
  const left = confirmed.slice(0, half);
  const right = confirmed.slice(half);

  const isEventOpen = event.status === "open";
  const deadlinePassed = status === "已截止";
  // Anyone can join while event is open (even after deadline). Cancel only allowed before deadline.
  const canJoin = isEventOpen && !mine;
  const canCancel = isEventOpen && !!mine && !deadlinePassed;
  const btnEnabled = canJoin || canCancel;
  const label = mine
    ? (deadlinePassed ? "已截止 · 無法退出"
       : mine.status === "confirmed" ? "取消接龍" : "取消候補")
    : (!isEventOpen ? status
       : full ? "加入候補 +1" : "接龍 +1");
  const btnStyle = mine
    ? { background: "var(--surface-2)", color: "var(--ink)" }
    : full
      ? { background: "var(--accent)", color: "var(--accent-ink)" }
      : { background: "var(--primary)", color: "var(--primary-ink)", boxShadow: "0 6px 16px color-mix(in oklab, var(--primary) 35%, transparent)" };

  const handle = () => {
    setErr("");
    start(async () => {
      try {
        if (mine) await cancel(event.id);
        else await register(event.id);
      } catch (e) { setErr((e as Error).message); }
    });
  };

  const share = async () => {
    const message = [
      "AAMA 網球社，歡迎一起來打球",
      `${event.title}`,
      `${event.event_date}（${d.weekday}）${hm(event.start_time)}–${hm(event.end_time)} @ ${event.venue.name}`,
      `報名連結 👉 ${shareUrl}`,
    ].join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
      } else {
        const ta = document.createElement("textarea");
        ta.value = message;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setErr("複製失敗，請手動複製連結"); }
  };

  if (!mounted) return null;
  const target = document.getElementById("phone-portal");
  if (!target) return null;

  return createPortal(
    <div className="absolute inset-0 z-50" onClick={close}>
      <div className="absolute inset-0 bg-black/55 animate-rise" />
      <div
        ref={sheetRef}
        onAnimationEnd={(e) => { if (e.target === e.currentTarget) setEntered(true); }}
        className={`${entered ? "" : "animate-sheet-up"} absolute inset-x-0 bottom-0 top-[10%] flex flex-col overflow-hidden rounded-t-[26px] bg-[var(--surface)]`}
        style={{
          boxShadow: "0 -12px 30px rgba(0,0,0,.25)",
          transform: entered && dragY ? `translateY(${dragY}px)` : undefined,
          transition: dragging ? "none" : "transform .28s cubic-bezier(.2,.7,.2,1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag-to-dismiss handle strip (sits above the scroll area) */}
        <div
          className="absolute top-0 left-0 right-0 z-20 h-6 flex items-start justify-center pt-2"
          style={{ touchAction: "none", cursor: dragging ? "grabbing" : "grab" }}
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="w-10 h-1 rounded-full bg-[color-mix(in_oklab,var(--ink)_25%,transparent)]" />
        </div>
        {/* Scrollable content */}
        <div
          className="flex-1 min-h-0 overflow-y-auto no-scrollbar"
          style={{
            overscrollBehavior: "contain",
            touchAction: "pan-y",
            WebkitOverflowScrolling: "touch",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
          }}
        >
        {/* Header gradient */}
        <div
          className="px-5 pt-6 pb-4 relative overflow-hidden"
          style={{ background: "linear-gradient(180deg,var(--court-soft) 0%,transparent 100%)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-[3px] rounded-full text-[11px] font-bold"
              style={{ background: "var(--accent)", color: "var(--accent-ink)" }}
            >
              {status === "接龍中" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
              {status}
            </span>
            {canManage && (
              <Link
                href={`/manage/${event.id}`}
                aria-label="編輯場次"
                className="press w-9 h-9 rounded-[10px] bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center shrink-0"
              >
                <Pencil className="w-4 h-4" style={{ color: "var(--ink)" }} strokeWidth={2.2} />
              </Link>
            )}
          </div>
          <h3 className="font-display text-[24px] font-bold mt-2 leading-[1.15]">{event.title}</h3>
          <div className="mt-2 text-[14px] text-[var(--ink-2)] flex flex-col gap-1.5">
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon className="w-4 h-4 shrink-0" />
              {event.event_date}（{d.weekday}）{hm(event.start_time)}–{hm(event.end_time)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-4 h-4 shrink-0" />
              {event.venue.name}
            </span>
            <span className="text-[12.5px] text-[var(--ink-3)]">
              退出截止：{formatTaipei(event.registration_deadline)}
            </span>
          </div>
          <div className="mt-3 flex gap-2">
            <a
              href={calendarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink-2)]"
            >
              <CalendarPlus className="w-3.5 h-3.5" />加入行事曆
            </a>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] border border-[var(--line)] px-3 py-1.5 text-[12px] font-semibold text-[var(--ink-2)]"
            >
              <Navigation className="w-3.5 h-3.5" />Google 地圖
            </a>
          </div>
          <div className="mt-3.5 flex items-center gap-2.5">
            <Avatar name={event.organizer.display_name} src={event.organizer.picture_url} size={28} />
            <div className="text-[12px]">
              <span className="text-[var(--ink-3)]">開場者 </span>
              <b>{event.organizer.display_name}</b>
            </div>
            <div className="ml-auto text-right">
              <div className="font-display tabular text-[22px] font-extrabold leading-none text-[var(--primary)]">
                ${perPerson ?? "—"}
              </div>
              <div className="text-[10px] text-[var(--ink-3)] tracking-[.06em] mt-0.5">預估 · 每人</div>
            </div>
          </div>
        </div>

        {/* Register CTA + Capacity bar */}
        <div className="px-5 pt-3.5 pb-2">
          <button
            type="button"
            onClick={handle}
            disabled={!btnEnabled || pending}
            className="press w-full h-[46px] rounded-full font-bold text-[15px] disabled:opacity-60"
            style={btnStyle}
          >
            {pending ? "處理中…" : label}
          </button>
          {err && <div className="mt-2 text-[12px] text-center" style={{ color: "var(--danger)" }}>{err}</div>}
          <div className="flex justify-between items-baseline mb-1.5 mt-4">
            <div className="text-[12.5px] font-bold">正取 · 候補</div>
            <div className="text-[11.5px] text-[var(--ink-3)] tabular">
              {event.confirmed_count}/{event.capacity}
              {event.waitlist_count > 0 && ` · 候補 ${event.waitlist_count}`}
            </div>
          </div>
          <div className="h-2 rounded-full overflow-hidden bg-[var(--surface-2)]">
            <div
              className="cap-fill h-full rounded-full"
              style={{
                width: `${pct}%`,
                background: full ? "var(--primary)" : "linear-gradient(90deg,var(--court),color-mix(in oklab,var(--court) 70%,var(--accent)))",
              }}
            />
          </div>
        </div>

        {/* Scrollable body */}
        <div className="px-5 pb-4">
          <div className="text-[11px] font-bold tracking-[.14em] uppercase text-[var(--ink-3)] mt-2.5 mb-2.5">
            正取 {confirmed.length} 人
          </div>
          {/* Tennis court roster */}
          <div className="relative rounded-[14px] p-3 overflow-hidden" style={{ background: "color-mix(in oklab, var(--court-soft) 70%, var(--surface))" }}>
            <svg
              aria-hidden
              className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)] opacity-35 pointer-events-none"
              style={{ color: "var(--court)" }}
              viewBox="0 0 78 36" fill="none" stroke="currentColor" strokeLinecap="square" preserveAspectRatio="none"
            >
              <rect x="0.5" y="0.5" width="77" height="35" strokeWidth=".5" vectorEffect="non-scaling-stroke" />
              <line x1="0.5" y1="4.5" x2="77.5" y2="4.5" strokeWidth=".4" vectorEffect="non-scaling-stroke" />
              <line x1="0.5" y1="31.5" x2="77.5" y2="31.5" strokeWidth=".4" vectorEffect="non-scaling-stroke" />
              <line x1="21" y1="4.5" x2="21" y2="31.5" strokeWidth=".4" vectorEffect="non-scaling-stroke" />
              <line x1="57" y1="4.5" x2="57" y2="31.5" strokeWidth=".4" vectorEffect="non-scaling-stroke" />
              <line x1="21" y1="18" x2="57" y2="18" strokeWidth=".4" vectorEffect="non-scaling-stroke" />
              <line x1="39" y1="0" x2="39" y2="36" strokeWidth=".7" strokeDasharray="1.2 .8" vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="relative grid grid-cols-2 gap-2 min-h-[140px]">
              {[left, right].map((players, side) => (
                <div key={side} className="flex flex-wrap items-start justify-center content-center gap-x-2 gap-y-3 py-2 px-1">
                  {players.map((r) => {
                    const isMe = r.member_id === meId;
                    return (
                      <div key={r.id} className="flex flex-col items-center gap-1">
                        <div style={isMe ? { outline: "2px solid var(--accent)", outlineOffset: "1px", borderRadius: "50%" } : undefined}>
                          <Avatar name={r.member.display_name} src={r.member.picture_url} size={38} />
                        </div>
                        <div
                          className="text-[10px] font-semibold max-w-[64px] text-center leading-tight line-clamp-2 break-words"
                          style={{ color: isMe ? "var(--primary)" : "var(--ink)" }}
                        >
                          {isMe ? "你" : r.member.display_name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {waitlisted.length > 0 && (
            <>
              <div className="text-[11px] font-bold tracking-[.14em] uppercase text-[var(--primary)] mt-4 mb-2">
                候補 {waitlisted.length} 人 · 排隊中
              </div>
              <div className="flex flex-col gap-1.5">
                {waitlisted.map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2.5 px-3 py-2 rounded-[12px] bg-[var(--surface-2)]">
                    <div className="w-6 text-center text-[12px] font-extrabold tabular text-[var(--primary)]">
                      #{i + 1}
                    </div>
                    <Avatar name={r.member.display_name} src={r.member.picture_url} size={28} />
                    <div className="text-[12.5px] font-semibold flex-1 truncate">
                      {r.member_id === meId ? "你" : r.member.display_name}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {event.status === "settled" && event.final_total !== null && (
            <>
              <div className="mt-4 rounded-[14px] p-3 text-[12.5px]" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                <div>已結算 · 實際 <b>${event.final_total}</b> · 每人 <b>${regs.find(r => r.attended === 1)?.amount_due ?? 0}</b></div>
                {mine && (
                  <div className="mt-1 font-bold">
                    {mine.attended === 1
                      ? (mine.paid_at ? `你已付 $${mine.paid_amount}` : `你待付 $${mine.amount_due}`)
                      : "你未出席，不需付款"}
                  </div>
                )}
                {(event.organizer.bank_code || event.organizer.bank_name || event.organizer.bank_account || event.organizer.bank_holder) && (
                  <div className="mt-2.5 pt-2.5 border-t border-[color-mix(in_oklab,var(--primary)_20%,transparent)] space-y-0.5">
                    <div className="text-[10.5px] font-bold uppercase tracking-[.08em] opacity-70">付款資訊</div>
                    <div><span className="opacity-70">付款人：</span><b>{event.organizer.display_name}</b></div>
                    {event.organizer.bank_holder && <div><span className="opacity-70">戶名：</span><b>{event.organizer.bank_holder}</b></div>}
                    {event.organizer.bank_name && <div><span className="opacity-70">銀行：</span><b>{event.organizer.bank_name}</b>{event.organizer.bank_code && <span>（代碼 {event.organizer.bank_code}）</span>}</div>}
                    {event.organizer.bank_account && <div><span className="opacity-70">帳號：</span><b className="tabular">{event.organizer.bank_account}</b></div>}
                  </div>
                )}
              </div>
              {(() => {
                const attendedRegs = regs.filter((r) => r.attended === 1);
                if (attendedRegs.length === 0) return null;
                const paidCount = attendedRegs.filter((r) => r.paid_at).length;
                return (
                  <div className="mt-4">
                    <div className="flex items-baseline justify-between mb-2">
                      <div className="text-[11px] font-bold uppercase text-[var(--ink-3)] tracking-[.08em]">收款狀態</div>
                      <div className="text-[11.5px] font-semibold text-[var(--ink-3)] tabular">{paidCount}/{attendedRegs.length}</div>
                    </div>
                    <div className="space-y-1.5">
                      {attendedRegs.map((r) => {
                        const paid = !!r.paid_at;
                        return (
                          <div key={r.id} className="flex items-center gap-2.5 rounded-[12px] bg-[var(--surface)] px-3 py-2 border border-[var(--line)]">
                            <Avatar name={r.member.display_name} src={r.member.picture_url} size={26} />
                            <span className="flex-1 text-[13px] font-semibold truncate">{r.member.display_name}</span>
                            <span className="text-[11.5px] tabular text-[var(--ink-2)]">${r.amount_due}</span>
                            <span className={`px-2 py-[2px] rounded-full text-[10.5px] font-bold whitespace-nowrap ${paid ? "bg-[color-mix(in_oklab,var(--success)_18%,transparent)] text-[var(--success)]" : "bg-[color-mix(in_oklab,var(--danger)_14%,transparent)] text-[var(--danger)]"}`}>
                              {paid ? "已付" : "未付"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}

          {event.note && (
            <div className="mt-4 rounded-[14px] p-3 bg-[var(--surface-2)] text-[12.5px] whitespace-pre-wrap">
              {event.note}
            </div>
          )}

          {/* Invite card */}
          <div className="mt-4 rounded-[16px] p-3.5 bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-1)]">
            <div className="text-[13.5px] font-bold text-[var(--ink)]">邀請朋友來打球</div>
            <div className="mt-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0 rounded-[10px] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] text-[var(--ink-2)] truncate tabular">
                {shareUrl}
              </div>
              <button
                type="button"
                onClick={share}
                className="press shrink-0 h-[42px] rounded-[10px] px-3.5 font-semibold text-[13px] flex items-center gap-1.5 transition-colors"
                style={{
                  background: copied ? "var(--primary-soft)" : "var(--primary)",
                  color: copied ? "var(--primary)" : "var(--primary-ink)",
                }}
              >
                {copied ? <Check className="w-4 h-4" strokeWidth={2.5} /> : <Copy className="w-4 h-4" strokeWidth={2.2} />}
                {copied ? "已複製" : "複製"}
              </button>
            </div>
            <div className="mt-2 text-[10.5px] text-[var(--ink-3)]">複製完整邀請訊息（含場次資訊與連結），貼到 LINE 或任何地方分享</div>
          </div>
        </div>

        </div>{/* end scroll */}
      </div>
    </div>,
    target,
  );
}
