"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign,
  Clock3, Printer, RefreshCw, Settings2, Sprout, TicketCheck, UtensilsCrossed, Users, XCircle,
} from "lucide-react";
import type { StatusBucket } from "@/lib/farm/status";
import type { StaffRole } from "@/lib/auth/roles";

const ROLE_LABELS: Record<StaffRole, string> = { admin: "管理員", reception: "接待員", kitchen: "餐飲／備料" };

type AdminSession = {
  id: string; startsAt: string; endsAt: string; status: string; experience: string;
  maxGroups: number; peopleLimit: number;
  confirmedGroups: number; confirmedPeople: number;
  requestedGroups: number; requestedPeople: number; pendingPaymentGroups: number;
  activeGroups: number; activePeople: number;
};

const STATUS_LABELS: Record<StatusBucket, string> = {
  hold: "暫留", pending_payment: "待付款", confirmed: "已確認", arrived: "已到場",
  completed: "已完成", cancelled: "已取消", exception: "異常",
};
const STATUS_ORDER: StatusBucket[] = ["hold", "pending_payment", "confirmed", "arrived", "completed", "cancelled", "exception"];

type AdminBooking = {
  id: string; bookingNumber: string; lookupCode: string; contactName: string; contactPhone: string;
  groupName: string; totalPeople: number; amountTwd: number; amountReceived: number; amountRefunded: number;
  trueOutstanding: number; overpaidAmount: number;
  bookingStatus: string; paymentStatus: string;
  statusBucket: StatusBucket; startsAt: string; endsAt: string; experience: string; createdAt: string;
  confirmedAt: string | null; claimedByName: string | null; waitingMinutes: number | null;
};

const dateFmt = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "short", timeZone: "Asia/Taipei" });
const timeFmt = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }); // en-CA => YYYY-MM-DD

function mondayOf(d: Date): Date {
  const taipei = new Date(d.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const day = taipei.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  taipei.setDate(taipei.getDate() + diff);
  taipei.setHours(0, 0, 0, 0);
  return taipei;
}
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
function dayKey(d: Date): string {
  return dayKeyFmt.format(d);
}

export default function FarmAdmin({ adminDisplayName, role }: { adminDisplayName: string; role: StaffRole }) {
  // 三種角色的分頁可見範圍（畫面層）——搭配每支 API 各自的角色檢查（見
  // current-member.ts 的 canViewFullOrders／canCheckIn／canManageSchedule／
  // canHandlePayment），兩邊各自獨立判斷，不是畫面藏了按鈕 API 就信任前端。
  const canSeeCalendarOrOrders = role === "admin" || role === "reception";
  const canSeeSettings = role === "admin";
  const [tab, setTab] = useState<"calendar" | "orders" | "prep" | "settings">(canSeeCalendarOrOrders ? "calendar" : "prep");
  const tabTitle = tab === "calendar" ? "接待行事曆" : tab === "orders" ? "預約與訂單" : tab === "prep" ? "準備工作" : "營運設定";
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar no-print">
        <div className="admin-logo"><Image src="/brand/wegrow-logo.png" width={50} height={50} alt="WeGrow" /><span><strong>WeGrow</strong><small>農場預約管理</small></span></div>
        <nav>
          {canSeeCalendarOrOrders && <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}><CalendarDays />接待行事曆</button>}
          {canSeeCalendarOrOrders && <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><TicketCheck />預約與訂單</button>}
          <button className={tab === "prep" ? "active" : ""} onClick={() => setTab("prep")}><Sprout />準備工作</button>
          {canSeeSettings && <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings2 />營運設定</button>}
        </nav>
        <Link href="/"><ArrowLeft />回到客戶預約頁</Link>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar no-print"><div><span className="section-kicker">WEGROW FARM OPERATIONS</span><h1>{tabTitle}</h1></div><span className="admin-whoami">{ROLE_LABELS[role]}：{adminDisplayName}</span></header>

        {/* 2026-10-28修正（Codex獨立重測D-20261028-01發現）：這裡原本連LINE Messaging API
            一起寫「尚未設定正式憑證」，跟下方「排程與同步狀態」卡片用credentialState
            判斷出的真實憑證狀態互相矛盾——LINE Messaging已經設定，只是還沒有非空的
            成功投遞紀錄可驗證（unverified），不是沒設定（not_configured）。這條橫幅
            只保留目前確實仍未開通的LINE Pay／信用卡／Google Calendar，LINE Messaging
            的真實狀態一律看下方卡片，不在這裡重複寫一句可能過期的靜態結論。 */}
        <div className="environment-warning no-print"><AlertTriangle /><span><strong>部分功能未正式開通</strong> LINE Pay、信用卡與 Google Calendar 尚未設定正式憑證；目前不接受真實付款。LINE 提醒的實際憑證與投遞狀態請見下方「排程與同步狀態」。</span></div>

        {tab === "calendar" && canSeeCalendarOrOrders && <CalendarView />}
        {tab === "orders" && canSeeCalendarOrOrders && <OrdersView role={role} />}
        {tab === "prep" && <PrepView role={role} />}
        {tab === "settings" && canSeeSettings && <SettingsView />}
      </section>
    </main>
  );
}

function DataConnectionRow({ state, lastUpdated, onRetry }: { state: "loading" | "ready" | "error"; lastUpdated: Date | null; onRetry: () => void }) {
  return (
    <div className="data-connection-row">
      <span className={`conn-pill conn-${state}`}>
        {state === "loading" ? <RefreshCw className="spin" /> : state === "error" ? <XCircle /> : <CheckCircle2 />}
        預約資料：{state === "loading" ? "更新中" : state === "error" ? "失敗" : "已更新"}
      </span>
      <span className="conn-time">{lastUpdated ? `最後更新 ${timeFmt.format(lastUpdated)}` : "尚未更新"}</span>
      <span className="conn-pill conn-notready">Sales 同步：尚未串接（規格待補，非本次範圍）</span>
      {state === "error" && <button className="secondary-button" onClick={onRetry}><RefreshCw /> 重試</button>}
    </div>
  );
}

function CalendarView() {
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [sessions, setSessions] = useState<AdminSession[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  // "loading" is entered from event handlers (nav buttons, retry) that
  // trigger a reload — never set synchronously inside the effect itself,
  // which React's set-state-in-effect lint rule flags as a cascading-render
  // risk. The effect only ever resolves to "ready" or "error".
  const retry = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);
  const goToWeek = useCallback((next: Date) => { setState("loading"); setWeekStart(next); }, []);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  // Fetch runs directly in the effect (matching FarmBookingApp.tsx's own
  // pattern) so state is only ever set from the async .then()/.catch()
  // callbacks, never synchronously in the effect body.
  useEffect(() => {
    const controller = new AbortController();
    const from = dayKey(days[0]);
    const to = dayKey(days[6]);
    fetch(`/api/farm/admin/sessions?from=${from}&to=${to}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as { sessions: AdminSession[] };
        setSessions(data.sessions);
        setState("ready");
        setLastUpdated(new Date());
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [days, reloadTick]);

  const byDay = useMemo(() => {
    const map = new Map<string, AdminSession[]>();
    for (const day of days) map.set(dayKey(day), []);
    for (const s of sessions ?? []) {
      const key = dayKeyFmt.format(new Date(s.startsAt));
      if (map.has(key)) map.get(key)!.push(s);
    }
    return map;
  }, [sessions, days]);

  const weekSessions = sessions ?? [];
  const openCount = weekSessions.filter((s) => s.status === "open").length;
  const confirmedVisits = weekSessions.reduce((sum, s) => sum + s.confirmedPeople, 0);
  const confirmedGroupCount = weekSessions.reduce((sum, s) => sum + s.confirmedGroups, 0);
  const needsAttention = weekSessions.filter((s) => s.activeGroups >= s.maxGroups || s.activePeople >= s.peopleLimit).length;

  return <>
    <DataConnectionRow state={state} lastUpdated={lastUpdated} onRetry={retry} />
    <div className="admin-metrics">
      <Metric icon={<CalendarDays />} label="本週開放場次" value={String(openCount)} note={`共 ${new Set(weekSessions.map((s) => dayKeyFmt.format(new Date(s.startsAt)))).size} 個日期`} />
      <Metric icon={<Users />} label="已確認來訪" value={String(confirmedVisits)} note={`${confirmedGroupCount} 團`} />
      <Metric icon={<CircleDollarSign />} label="淨收款" value="待設定" note="票價尚未核定" />
      <Metric icon={<AlertTriangle />} label="額滿場次" value={String(needsAttention)} note="人數或團數已達上限" alert={needsAttention > 0} />
    </div>
    <div className="admin-section">
      <div className="admin-section-title"><div><h2>{dateFmt.format(days[0])} – {dateFmt.format(days[6])}</h2><p>一眼看每時段團數與總人數，上限固定 30 人、最多 2 團。</p></div>
        <div className="week-nav">
          <button className="secondary-button" onClick={() => goToWeek(addDays(weekStart, -7))}>上一週</button>
          <button className="secondary-button" onClick={() => goToWeek(mondayOf(new Date()))}>本週</button>
          <button className="secondary-button" onClick={() => goToWeek(addDays(weekStart, 7))}>下一週</button>
        </div>
      </div>
      {state === "error" ? <div className="empty-admin"><AlertTriangle /><strong>資料讀取失敗</strong><span>請按上方「重試」</span></div> : (
        <div className="week-grid">
          {days.map((day, index) => {
            const key = dayKey(day);
            const daySessions = byDay.get(key) ?? [];
            return (
              <div key={key} className={index > 4 ? "day weekend" : "day"}>
                <strong>{dateFmt.format(day)}</strong>
                {state === "loading" && <span className="day-loading">載入中…</span>}
                {daySessions.map((s) => {
                  const full = s.activeGroups >= s.maxGroups || s.activePeople >= s.peopleLimit;
                  const busy = s.activeGroups > 0 && !full;
                  const tone = full ? "full" : busy ? "busy" : "open";
                  return <Session key={s.id} time={timeFmt.format(new Date(s.startsAt))} detail={`${s.activeGroups}/${s.maxGroups} 團／${s.activePeople}/${s.peopleLimit} 人`} tone={tone} />;
                })}
                {state === "ready" && daySessions.length === 0 && <span className="day-empty">無開放場次</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  </>;
}

function OrdersView({ role }: { role: StaffRole }) {
  const canManage = role === "admin"; // 改期／確認／取消：僅管理員
  const canCheckIn = role === "admin" || role === "reception"; // 報到：管理員＋接待員都可以
  const [statusFilter, setStatusFilter] = useState<StatusBucket | null>(null);
  const [unclaimedOnly, setUnclaimedOnly] = useState(false);
  const [counts, setCounts] = useState<Record<StatusBucket, number> | null>(null);
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const retry = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);
  const selectStatus = useCallback((bucket: StatusBucket | null) => { setState("loading"); setUnclaimedOnly(false); setStatusFilter(bucket); }, []);
  const selectUnclaimed = useCallback(() => { setState("loading"); setStatusFilter(null); setUnclaimedOnly(true); }, []);

  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [staffOptions, setStaffOptions] = useState<{ id: string; displayName: string; role: string }[] | null>(null);
  const [staffOptionsState, setStaffOptionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [assignTarget, setAssignTarget] = useState("");

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [slotOptions, setSlotOptions] = useState<AdminSession[] | null>(null);
  const [slotOptionsState, setSlotOptionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [rescheduleTarget, setRescheduleTarget] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const qs = unclaimedOnly ? "?unclaimed=true" : statusFilter ? `?status=${statusFilter}` : "";
    fetch(`/api/farm/admin/bookings${qs}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as { counts: Record<StatusBucket, number>; bookings: AdminBooking[] };
        setCounts(data.counts);
        setBookings(data.bookings);
        setState("ready");
        setLastUpdated(new Date());
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [statusFilter, unclaimedOnly, reloadTick]);

  // Lazily fetched once, same pattern as openReschedule's slotOptions.
  async function openAssign(bookingId: string) {
    setActionError(null);
    setAssigningId(bookingId);
    setAssignTarget("");
    if (staffOptionsState === "ready" || staffOptionsState === "loading") return;
    setStaffOptionsState("loading");
    try {
      const res = await fetch("/api/farm/admin/staff");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { staff: { id: string; displayName: string; role: string }[] };
      setStaffOptions(data.staff);
      setStaffOptionsState("ready");
    } catch {
      setStaffOptionsState("error");
    }
  }

  async function runAssign(bookingId: string) {
    if (!assignTarget) return;
    setActionError(null);
    const res = await fetch(`/api/farm/admin/bookings/${bookingId}/assign-claim`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: assignTarget }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setActionError(body.error ?? `指派失敗（${res.status}）`);
      return;
    }
    setAssigningId(null);
    retry();
  }

  async function runAction(bookingId: string, action: "confirm" | "cancel" | "check_in" | "complete") {
    setActionError(null);
    const res = await fetch(`/api/farm/admin/bookings/${bookingId}/status`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setActionError(body.error ?? `動作失敗（${res.status}）`);
      return;
    }
    retry();
  }

  // Lazily fetched once (not in an effect — triggered from the "改期" click
  // handler, matching the same avoid-synchronous-setState-in-effect
  // discipline used elsewhere in this file) and reused across all rows.
  async function openReschedule(bookingId: string) {
    setActionError(null);
    setReschedulingId(bookingId);
    setRescheduleTarget("");
    if (slotOptionsState === "ready" || slotOptionsState === "loading") return;
    setSlotOptionsState("loading");
    const from = dayKey(new Date());
    const to = dayKey(addDays(new Date(), 90));
    try {
      const res = await fetch(`/api/farm/admin/sessions?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json() as { sessions: AdminSession[] };
      setSlotOptions(data.sessions.filter((s) => s.status === "open"));
      setSlotOptionsState("ready");
    } catch {
      setSlotOptionsState("error");
    }
  }

  async function runReschedule(bookingId: string) {
    if (!rescheduleTarget) return;
    setActionError(null);
    const res = await fetch(`/api/farm/admin/bookings/${bookingId}/reschedule`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newSlotId: rescheduleTarget }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setActionError(body.error ?? `改期失敗（${res.status}）`);
      return;
    }
    setReschedulingId(null);
    retry();
  }

  const [payingId, setPayingId] = useState<string | null>(null);
  const [payType, setPayType] = useState<"payment" | "refund">("payment");
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "transfer" | "other">("cash");
  const [payReference, setPayReference] = useState("");
  const [paySubmitting, setPaySubmitting] = useState(false);
  const payIdempotencyKey = useRef("");

  function openPayment(bookingId: string) {
    setActionError(null);
    setPayingId(bookingId);
    setPayType("payment");
    setPayAmount("");
    setPayMethod("cash");
    setPayReference("");
    setPaySubmitting(false);
    // 同一次表單只用一把 key（雙擊「登記」不會產生兩筆）；每次重新打開表單才換新。
    payIdempotencyKey.current = crypto.randomUUID();
  }

  async function runPayment(bookingId: string) {
    if (paySubmitting) return;
    const amount = Number(payAmount);
    if (!Number.isInteger(amount) || amount <= 0) { setActionError("請輸入正確的金額"); return; }
    setActionError(null);
    setPaySubmitting(true);
    try {
      const res = await fetch(`/api/farm/admin/bookings/${bookingId}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: payType, amountTwd: amount, method: payMethod, referenceNote: payReference, idempotencyKey: payIdempotencyKey.current }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setActionError(body.error ?? `登記失敗（${res.status}）`);
        return;
      }
      setPayingId(null);
      retry();
    } finally {
      setPaySubmitting(false);
    }
  }

  return <div className="admin-section">
    <DataConnectionRow state={state} lastUpdated={lastUpdated} onRetry={retry} />
    <div className="admin-section-title"><div><h2>預約訂單</h2><p>預約狀態與付款狀態分開，不用付款成功假裝預約一定成立。</p></div></div>
    <div className="status-filter-row">
      <button className={!unclaimedOnly && statusFilter === null ? "status-filter active" : "status-filter"} onClick={() => selectStatus(null)}>全部 {counts ? Object.values(counts).reduce((a, b) => a + b, 0) : ""}</button>
      {STATUS_ORDER.map((bucket) => (
        <button key={bucket} className={!unclaimedOnly && statusFilter === bucket ? `status-filter active status-b-${bucket}` : `status-filter status-b-${bucket}`} onClick={() => selectStatus(bucket)}>
          {STATUS_LABELS[bucket]} {counts ? counts[bucket] : ""}
        </button>
      ))}
      <button className={unclaimedOnly ? "status-filter active status-b-exception" : "status-filter status-b-exception"} onClick={selectUnclaimed}>未接單</button>
    </div>
    {actionError && <div className="action-error"><AlertTriangle /> {actionError}</div>}
    {state === "error" ? <div className="empty-admin"><AlertTriangle /><strong>資料讀取失敗</strong><span>請按上方「重試」</span></div> : (
      <div className="order-table">
        <div className="order-row order-head"><span>訂單</span><span>聯絡人</span><span>時段</span><span>人數</span><span>收款</span><span>狀態</span><span>操作</span></div>
        {state === "loading" && <div className="empty-admin"><RefreshCw className="spin" /><strong>載入中…</strong></div>}
        {state === "ready" && (bookings ?? []).length === 0 && <div className="empty-admin"><TicketCheck /><strong>這個篩選條件下沒有訂單</strong></div>}
        {(bookings ?? []).map((b) => (
          <div className="order-row-group" key={b.id}>
            <div className="order-row">
              <strong>{b.bookingNumber}</strong>
              <span>{b.contactName}{b.groupName ? `（${b.groupName}）` : ""}</span>
              <span>{dateFmt.format(new Date(b.startsAt))} {timeFmt.format(new Date(b.startsAt))}</span>
              <span>{b.totalPeople} 位</span>
              <span className="payment-cell">
                <small>應收 NT$ {b.amountTwd.toLocaleString()}{b.statusBucket === "cancelled" ? "（已取消）" : ""}</small>
                {b.overpaidAmount > 0
                  ? <strong className="overpaid">超收 NT$ {b.overpaidAmount.toLocaleString()}</strong>
                  : <strong className={b.trueOutstanding > 0 ? "outstanding" : "settled"}>{b.trueOutstanding > 0 ? `未收 NT$ ${b.trueOutstanding.toLocaleString()}` : "已收清"}</strong>}
              </span>
              <span className={`status-pill status-b-${b.statusBucket}`}>
                {STATUS_LABELS[b.statusBucket]}
                {b.statusBucket === "confirmed" && (
                  b.claimedByName
                    ? <small className="claim-note">已接單：{b.claimedByName}</small>
                    : <small className="claim-note claim-note-unclaimed">未接單{b.waitingMinutes !== null ? `・已等${b.waitingMinutes}分` : ""}</small>
                )}
              </span>
              <span className="order-actions">
                {canManage && b.statusBucket === "hold" && <button onClick={() => runAction(b.id, "confirm")}>確認</button>}
                {canManage && (b.statusBucket === "hold" || b.statusBucket === "confirmed") && <button onClick={() => runAction(b.id, "cancel")}>取消</button>}
                {canManage && (b.statusBucket === "hold" || b.statusBucket === "confirmed") && <button onClick={() => openReschedule(b.id)}>改期</button>}
                {canManage && b.statusBucket === "confirmed" && !b.claimedByName && <button onClick={() => openAssign(b.id)}>指定接待人</button>}
                {canCheckIn && b.statusBucket === "confirmed" && <button onClick={() => runAction(b.id, "check_in")}>報到</button>}
                {canManage && b.statusBucket === "arrived" && <button onClick={() => runAction(b.id, "complete")}>完成</button>}
                {canManage && b.statusBucket !== "cancelled" && <button onClick={() => openPayment(b.id)}>收款</button>}
              </span>
            </div>
            {assigningId === b.id && (
              <div className="reschedule-row">
                {staffOptionsState === "loading" && <span><RefreshCw className="spin" size={14} /> 載入人員清單中…</span>}
                {staffOptionsState === "error" && <span className="action-error-inline">人員清單讀取失敗</span>}
                {staffOptionsState === "ready" && (
                  <>
                    <select value={assignTarget} onChange={(e) => setAssignTarget(e.target.value)}>
                      <option value="">選擇接待人…</option>
                      {(staffOptions ?? []).map((s) => (
                        <option key={s.id} value={s.id}>{s.displayName}（{s.role === "admin" ? "管理員" : "接待員"}）</option>
                      ))}
                    </select>
                    <button className="secondary-button" disabled={!assignTarget} onClick={() => runAssign(b.id)}>確定指派</button>
                  </>
                )}
                <button className="secondary-button" onClick={() => setAssigningId(null)}>取消</button>
              </div>
            )}
            {reschedulingId === b.id && (
              <div className="reschedule-row">
                {slotOptionsState === "loading" && <span><RefreshCw className="spin" size={14} /> 載入可選時段中…</span>}
                {slotOptionsState === "error" && <span className="action-error-inline">時段清單讀取失敗</span>}
                {slotOptionsState === "ready" && (
                  <>
                    <select value={rescheduleTarget} onChange={(e) => setRescheduleTarget(e.target.value)}>
                      <option value="">選擇新時段…</option>
                      {(slotOptions ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {dateFmt.format(new Date(s.startsAt))} {timeFmt.format(new Date(s.startsAt))}（{s.activeGroups}/{s.maxGroups} 團・{s.activePeople}/{s.peopleLimit} 人）
                        </option>
                      ))}
                    </select>
                    <button className="secondary-button" disabled={!rescheduleTarget} onClick={() => runReschedule(b.id)}>確定改期</button>
                  </>
                )}
                <button className="secondary-button" onClick={() => setReschedulingId(null)}>取消</button>
              </div>
            )}
            {payingId === b.id && (
              <div className="payment-row">
                <select value={payType} onChange={(e) => setPayType(e.target.value as "payment" | "refund")}>
                  <option value="payment">收款</option>
                  <option value="refund">退款</option>
                </select>
                <input type="number" min={1} placeholder="金額 (NT$)" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
                <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as "cash" | "transfer" | "other")}>
                  <option value="cash">現金</option>
                  <option value="transfer">轉帳</option>
                  <option value="other">其他</option>
                </select>
                <input type="text" placeholder="交易末碼／憑證（選填）" value={payReference} onChange={(e) => setPayReference(e.target.value)} />
                <button className="secondary-button" disabled={paySubmitting} onClick={() => runPayment(b.id)}>{paySubmitting ? "登記中…" : "登記"}</button>
                <button className="secondary-button" onClick={() => setPayingId(null)}>取消</button>
              </div>
            )}
          </div>
        ))}
      </div>
    )}
  </div>;
}

type PrepBooking = {
  bookingNumber: string; contactName: string; groupName: string; totalPeople: number;
  plantCount: number; mealCount: number; vegetarianMealCount: number | null; nonVegetarianMealCount: number | null;
  note: string; confirmed: boolean;
};
type PrepSession = { id: string; startsAt: string; endsAt: string; experience: string; bookings: PrepBooking[] };

function PrepView({ role }: { role: StaffRole }) {
  const showIdentity = role !== "kitchen"; // 餐飲／備料只看時間、份數與飲食備註
  const [date, setDate] = useState(() => dayKey(new Date()));
  const [sessions, setSessions] = useState<PrepSession[] | null>(null);
  const [totals, setTotals] = useState<{ groups: number; people: number; plant: number; meal: number; vegetarianMeal: number; vegetarianUnconfirmedMeals: number } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadTick, setReloadTick] = useState(0);
  const retry = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);
  const changeDate = useCallback((next: string) => { setState("loading"); setDate(next); }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/farm/admin/prep?date=${date}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as { sessions: PrepSession[]; totals: { groups: number; people: number; plant: number; meal: number; vegetarianMeal: number; vegetarianUnconfirmedMeals: number } };
        setSessions(data.sessions);
        setTotals(data.totals);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [date, reloadTick]);

  return (
    <div className="admin-section">
      <div className="admin-section-title no-print">
        <div><h2>準備工作彙總＋工作單</h2><p>依日期彙總盆栽／餐飲數量，供現場備料與交接；可直接列印。</p></div>
        <div className="prep-toolbar">
          <input type="date" value={date} onChange={(e) => changeDate(e.target.value)} />
          <button className="secondary-button" onClick={retry}><RefreshCw /> 重新整理</button>
          <button className="secondary-button" onClick={() => window.print()}><Printer /> 列印工作單</button>
        </div>
      </div>
      <div className="prep-print-header only-print"><h2>WeGrow 農場參訪工作單</h2><p>{dateFmt.format(new Date(`${date}T00:00:00+08:00`))}</p></div>

      {state === "error" && <div className="empty-admin no-print"><AlertTriangle /><strong>資料讀取失敗</strong><span>請按「重新整理」</span></div>}
      {state === "loading" && <div className="empty-admin no-print"><RefreshCw className="spin" /><strong>載入中…</strong></div>}
      {state === "ready" && (sessions ?? []).length === 0 && <div className="empty-admin"><Sprout /><strong>這天沒有有效訂單</strong></div>}

      {state === "ready" && (sessions ?? []).length > 0 && (
        <>
          <div className="admin-metrics no-print">
            <Metric icon={<TicketCheck />} label="訂單數" value={String(totals?.groups ?? 0)} note="含暫留與待付款" />
            <Metric icon={<Users />} label="總人數" value={String(totals?.people ?? 0)} note="" />
            <Metric icon={<Sprout />} label="盆栽加購" value={String(totals?.plant ?? 0)} note="盆" />
            <Metric icon={<UtensilsCrossed />} label="餐飲：素食／已確認" value={`${totals?.vegetarianMeal ?? 0} 份`} note={totals && totals.vegetarianUnconfirmedMeals > 0 ? `另有 ${totals.vegetarianUnconfirmedMeals} 份飲食別未確認，需人工聯繫` : `餐飲共 ${totals?.meal ?? 0} 份`} alert={!!totals && totals.vegetarianUnconfirmedMeals > 0} />
          </div>
          {(sessions ?? []).map((s) => (
            <div key={s.id} className="prep-session">
              <h3><Clock3 size={15} /> {timeFmt.format(new Date(s.startsAt))}–{timeFmt.format(new Date(s.endsAt))}　{s.experience}</h3>
              <table className="prep-table">
                <thead><tr>{showIdentity && <><th>訂單編號</th><th>聯絡人／團名</th></>}{!showIdentity && <th>團別</th>}<th>人數</th><th>盆栽</th><th>餐飲（葷／素）</th><th>狀態</th><th>飲食備註</th></tr></thead>
                <tbody>
                  {s.bookings.map((b, i) => (
                    <tr key={b.bookingNumber || `${s.id}-${i}`}>
                      {showIdentity && <><td>{b.bookingNumber}</td><td>{b.contactName}{b.groupName ? `（${b.groupName}）` : ""}</td></>}
                      {!showIdentity && <td>{b.contactName}</td>}
                      <td>{b.totalPeople}</td>
                      <td>{b.plantCount || "—"}</td>
                      <td>{b.mealCount === 0 ? "—" : b.vegetarianMealCount === null ? `${b.mealCount} 份（素食未確認）` : `葷 ${b.nonVegetarianMealCount}／素 ${b.vegetarianMealCount}`}</td>
                      <td>{b.confirmed ? "已確認" : "待確認"}</td>
                      <td>{b.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

type JobRun = {
  id: string; triggerSource: string; startedAt: string; completedAt: string | null;
  dueCount: number; sentCount: number; failedCount: number; blockedCount: number;
  oldestPendingSeconds: number | null; errorSummary: string | null;
};
type CredentialState = "not_configured" | "unverified" | "healthy" | "failing";
type JobStatus = {
  jobName: string; credentialState: CredentialState;
  lastRunAt: string | null; lastRunTriggerSource: string | null; lastRunCompletedAt: string | null; lastHealthyRunAt: string | null;
  oldestPendingSeconds: number | null; deadLetterCount: number; excludedCount: number; recentRuns: JobRun[];
  alerts: { heartbeatMissed: boolean; backlogTooOld: boolean; hasCredentialErrors: boolean; hasDeadLetters: boolean; thresholds: { heartbeatMissedMinutes: number; backlogTooOldSeconds: number } };
};

// 2026-10-28 D-20261028-01：四個互斥狀態各自對應的顯示文字跟樣式，不是直接
// 把文案從「未設定」改寫成「已啟用」——沒有判斷依據的狀態就該顯示「待驗證」。
const CREDENTIAL_STATE_LABEL: Record<CredentialState, { text: string; cls: string }> = {
  not_configured: { text: "未設定", cls: "cred-state-missing" },
  unverified: { text: "已設定，尚無執行紀錄可驗證", cls: "cred-state-unverified" },
  healthy: { text: "最近一次執行正常", cls: "cred-state-healthy" },
  failing: { text: "最近一次執行失敗，需人工確認", cls: "cred-state-failing" },
};

const dateTimeFmt = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

function JobStatusCard({ status, onRetried }: { status: JobStatus; onRetried: () => void }) {
  const [retrying, setRetrying] = useState(false);
  async function retryFailed() {
    if (retrying) return;
    setRetrying(true);
    try {
      await fetch("/api/farm/admin/job-status/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobName: status.jobName }) });
      onRetried();
    } finally {
      setRetrying(false);
    }
  }
  const label = status.jobName === "reminders" ? "LINE 提醒" : "Sales 同步";
  const anyAlert = status.alerts.heartbeatMissed || status.alerts.backlogTooOld || status.alerts.hasCredentialErrors || status.alerts.hasDeadLetters;
  return (
    <div className="job-status-card">
      <div className="job-status-head">
        <strong>{label}</strong>
        {anyAlert ? <span className="job-alert-pill alert"><AlertTriangle size={12} /> 需注意</span> : <span className="job-alert-pill ok"><CheckCircle2 size={12} /> 正常</span>}
      </div>
      <div className="job-status-grid">
        <span>憑證狀態</span><span className={CREDENTIAL_STATE_LABEL[status.credentialState].cls}>{CREDENTIAL_STATE_LABEL[status.credentialState].text}</span>
        <span>最近一次成功</span><span>{status.lastHealthyRunAt ? dateTimeFmt.format(new Date(status.lastHealthyRunAt)) : "尚無成功執行紀錄"}</span>
        <span>最後啟動</span><span>{status.lastRunAt ? `${dateTimeFmt.format(new Date(status.lastRunAt))}（${status.lastRunTriggerSource === "cron" ? "排程" : "手動"}）` : "尚未啟動過"}</span>
        <span>最舊積壓</span><span>{status.oldestPendingSeconds === null ? "無積壓" : `${Math.round(status.oldestPendingSeconds / 60)} 分鐘`}</span>
        <span>需人工處理</span><span>{status.deadLetterCount} 筆{status.deadLetterCount > 0 && <button className="secondary-button" disabled={retrying} onClick={retryFailed}>{retrying ? "重試中…" : "全部重試（不含下方已排除事件）"}</button>}</span>
        <span>已排除測試事件</span><span>{status.excludedCount} 筆（永久排除，不計入待處理，不會被「全部重試」復活）</span>
      </div>
      {status.alerts.heartbeatMissed && <div className="job-alert-line">⚠ 超過 {status.alerts.thresholds.heartbeatMissedMinutes} 分鐘沒有任何一次啟動紀錄（排程可能沒有正確觸發）</div>}
      {status.alerts.backlogTooOld && <div className="job-alert-line">⚠ 最舊待處理事件已等待超過 {Math.round(status.alerts.thresholds.backlogTooOldSeconds / 60)} 分鐘</div>}
      {status.alerts.hasCredentialErrors && <div className="job-alert-line">⚠ 最近有憑證相關錯誤，需要人工確認</div>}
      <table className="job-runs-table">
        <thead><tr><th>時間</th><th>來源</th><th>應處理</th><th>成功</th><th>失敗</th><th>阻塞</th></tr></thead>
        <tbody>
          {status.recentRuns.length === 0 && <tr><td colSpan={6}>尚無執行紀錄</td></tr>}
          {status.recentRuns.map((r) => (
            <tr key={r.id}>
              <td>{dateTimeFmt.format(new Date(r.startedAt))}</td>
              <td>{r.triggerSource === "cron" ? "排程" : "手動"}</td>
              <td>{r.dueCount}</td><td>{r.sentCount}</td><td>{r.failedCount}</td><td>{r.blockedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobStatusPanel() {
  const [status, setStatus] = useState<{ reminders: JobStatus; salesSync: JobStatus } | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [reloadTick, setReloadTick] = useState(0);
  const retry = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/farm/admin/job-status", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as { reminders: JobStatus; salesSync: JobStatus };
        setStatus(data);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [reloadTick]);

  return (
    <div className="admin-section job-status-panel">
      <div className="admin-section-title"><div><h2>排程與同步狀態</h2><p>LINE 提醒與 Sales 同步 job 的最近啟動、積壓與失敗紀錄——不是只在開發終端印 log。</p></div>
        <button className="secondary-button" onClick={retry}><RefreshCw /> 重新整理</button>
      </div>
      {state === "loading" && <div className="empty-admin"><RefreshCw className="spin" /><strong>載入中…</strong></div>}
      {state === "error" && <div className="empty-admin"><AlertTriangle /><strong>讀取失敗</strong></div>}
      {state === "ready" && status && (
        <div className="job-status-columns">
          <JobStatusCard status={status.reminders} onRetried={retry} />
          <JobStatusCard status={status.salesSync} onRetried={retry} />
        </div>
      )}
    </div>
  );
}

function SettingsView() {
  return <div className="settings-columns">
    <div className="admin-section"><h2>容量政策</h2><p>此規則已依使用者確認固定；變更時建立新版本，不回寫舊訂單。</p><div className="policy-list"><label>每時段總人數上限<input value="30" readOnly /></label><label>每時段最多團數<input value="2" readOnly /></label></div><div className="verified-line"><CheckCircle2 />規則版本 V2：每時段 30 人／最多 2 團，不分團數分級</div></div>
    <UnclaimedEscalationPanel />
    <StaffRolePanel />
    <div className="admin-section"><h2>待正式核定</h2><ul className="checklist"><li>成人、兒童與幼兒票價及年齡</li><li>付款保留時間（開發預設 10 分鐘）</li><li>前一天提醒時間（開發預設 18:00；LINE提醒與Sales同步的實際憑證/執行狀態見下方「排程與同步狀態」卡片，不在這裡重複寫死文案）</li><li>地址、導航、雨天、取消與退款政策</li><li>金流／Google Calendar 憑證</li></ul></div>
    <JobStatusPanel />
  </div>;
}

// PDF建議30分鐘，Clement還沒定案——這裡沒有預設值，讀到null就顯示「尚未設定
// （自動升級停用）」，不是靜靜把30帶進輸入框讓人以為那已經是正式規則。
function UnclaimedEscalationPanel() {
  const [minutes, setMinutes] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/farm/admin/settings", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json() as { unclaimedEscalationMinutes: number | null };
        setMinutes(data.unclaimedEscalationMinutes);
        setDraft(data.unclaimedEscalationMinutes === null ? "" : String(data.unclaimedEscalationMinutes));
        setState("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, []);

  async function save(next: number | null) {
    setSaving(true); setSaveError(null);
    try {
      const res = await fetch("/api/farm/admin/settings", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ unclaimedEscalationMinutes: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? `儲存失敗（${res.status}）`);
        return;
      }
      setMinutes(next);
      setSavedAt(new Date());
    } finally {
      setSaving(false);
    }
  }

  return <div className="admin-section">
    <h2>未接單升級提醒</h2>
    <p>超過設定分鐘仍未接單的「已確認」預約，麻豆群會收到額外提醒＋重發接單按鈕。PDF建議值為30分鐘，但這是建議值，不是已確認規則——留空＝停用自動升級，「訂單」頁的「未接單」清單仍會照常顯示等待時間，可手動指定接待人。</p>
    {state === "loading" && <div className="empty-admin"><RefreshCw className="spin" size={14} /> 載入中…</div>}
    {state === "error" && <div className="action-error-inline">設定讀取失敗</div>}
    {state === "ready" && (
      <div className="policy-list">
        <label>升級門檻（分鐘，留空＝停用）
          <input type="number" min={1} max={1440} placeholder="未設定" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
        <div className="order-actions">
          <button
            disabled={saving}
            onClick={() => {
              const n = draft.trim() === "" ? null : Number(draft);
              if (n !== null && (!Number.isInteger(n) || n <= 0)) { setSaveError("請輸入正整數分鐘數，或留空停用"); return; }
              void save(n);
            }}
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
          {draft !== "" && <button className="secondary-button" disabled={saving} onClick={() => { setDraft(""); void save(null); }}>停用自動升級</button>}
        </div>
        {saveError && <div className="action-error-inline">{saveError}</div>}
        <div className="verified-line">
          <CheckCircle2 />
          {minutes === null ? "目前：自動升級已停用" : `目前：超過 ${minutes} 分鐘未接單會發出群組提醒`}
          {savedAt && `（已儲存 ${savedAt.toLocaleTimeString("zh-TW")}）`}
        </div>
      </div>
    )}
  </div>;
}

type StaffMember = { id: string; displayName: string; role: string };
type RoleAuditEntry = {
  id: string; member_id: string; member_name: string | null;
  actor_id: string | null; actor_name: string | null;
  from_state: string | null; to_state: string | null; reason: string | null; created_at: string;
};

const ASSIGNABLE_ROLE_LABELS: Record<string, string> = { admin: "管理員", reception: "接待員", kitchen: "餐飲／備料", member: "一般使用者（無員工權限）" };

// 2026-10-26補強：之前整個repo沒有任何畫面能指派角色，Clement自己的admin
// 升級是直接對production D1下UPDATE，完全沒有紀錄。這裡用後台畫面操作，
// 不要求Clement自己呼叫POST——選人、選角色、按儲存，稽核紀錄自動寫入。
function StaffRolePanel() {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [audit, setAudit] = useState<RoleAuditEntry[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pendingRole, setPendingRole] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/api/farm/admin/staff?all=1", { signal: controller.signal }).then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json() as Promise<{ staff: StaffMember[] }>; }),
      fetch("/api/farm/admin/staff/audit", { signal: controller.signal }).then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json() as Promise<{ changes: RoleAuditEntry[] }>; }),
    ])
      .then(([staffRes, auditRes]) => { setMembers(staffRes.staff); setAudit(auditRes.changes); setState("ready"); })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState("error");
      });
    return () => controller.abort();
  }, [reloadTick]);

  async function saveRole(memberId: string) {
    const role = pendingRole[memberId];
    if (!role) return;
    setSavingId(memberId); setSaveError(null);
    try {
      const res = await fetch("/api/farm/admin/staff", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setSaveError(body.error ?? `儲存失敗（${res.status}）——非管理員會被拒絕，角色變更與稽核紀錄是同一次請求，沒有半成功的狀態`);
        return;
      }
      reload();
    } finally {
      setSavingId(null);
    }
  }

  return <div className="admin-section">
    <h2><Users size={16} style={{ verticalAlign: "-2px", marginRight: 4 }} />成員與角色管理</h2>
    <p>只有管理員能在這裡改角色；每次變更都會寫進下方「變更紀錄」，不是改了就沒人知道。一次只處理一個人，不批次調整。</p>
    {state === "loading" && <div className="empty-admin"><RefreshCw className="spin" size={14} /> 載入中…</div>}
    {state === "error" && <div className="action-error-inline">成員清單讀取失敗</div>}
    {state === "ready" && (
      <>
        <table className="staff-role-table">
          <thead><tr><th>成員</th><th>目前角色</th><th>變更為</th><th></th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.displayName}</td>
                <td>{ASSIGNABLE_ROLE_LABELS[m.role] ?? m.role}</td>
                <td>
                  <select value={pendingRole[m.id] ?? m.role} onChange={(e) => setPendingRole((p) => ({ ...p, [m.id]: e.target.value }))}>
                    {Object.entries(ASSIGNABLE_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
                <td>
                  <button
                    className="secondary-button"
                    disabled={savingId === m.id || (pendingRole[m.id] ?? m.role) === m.role}
                    onClick={() => void saveRole(m.id)}
                  >
                    {savingId === m.id ? "儲存中…" : "儲存"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {saveError && <div className="action-error-inline">{saveError}</div>}
        <button className="secondary-button" style={{ marginTop: 10 }} onClick={() => setShowAudit((v) => !v)}>
          {showAudit ? "隱藏變更紀錄" : `查看變更紀錄（${audit.length}）`}
        </button>
        {showAudit && (
          audit.length === 0
            ? <div className="empty-admin">目前沒有任何透過這個畫面做的角色變更紀錄。</div>
            : <ul className="checklist">
                {audit.map((a) => (
                  <li key={a.id}>
                    {a.created_at.slice(0, 16).replace("T", " ")}｜{a.actor_name ?? "（操作者未知）"} 把 {a.member_name ?? a.member_id} 的角色從「{ASSIGNABLE_ROLE_LABELS[a.from_state ?? ""] ?? a.from_state}」改成「{ASSIGNABLE_ROLE_LABELS[a.to_state ?? ""] ?? a.to_state}」
                    {a.reason && `（${a.reason}）`}
                  </li>
                ))}
              </ul>
        )}
      </>
    )}
  </div>;
}

function Metric({ icon, label, value, note, alert }: { icon: React.ReactNode; label: string; value: string; note: string; alert?: boolean }) {
  return <div className={alert ? "metric alert" : "metric"}><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>;
}

function Session({ time, detail, tone }: { time: string; detail: string; tone: string }) {
  return <div className={`calendar-session ${tone}`}><Clock3 /><strong>{time}</strong><span>{detail}</span></div>;
}
