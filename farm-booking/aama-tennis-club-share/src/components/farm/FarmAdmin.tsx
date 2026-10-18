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

        <div className="environment-warning no-print"><AlertTriangle /><span><strong>部分功能未正式開通</strong> LINE Messaging API、LINE Pay、信用卡與 Google Calendar 尚未設定正式憑證；目前不接受真實付款，提醒僅會排入佇列但不會真的送出。</span></div>

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
  const [counts, setCounts] = useState<Record<StatusBucket, number> | null>(null);
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const retry = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);
  const selectStatus = useCallback((bucket: StatusBucket | null) => { setState("loading"); setStatusFilter(bucket); }, []);

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [slotOptions, setSlotOptions] = useState<AdminSession[] | null>(null);
  const [slotOptionsState, setSlotOptionsState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [rescheduleTarget, setRescheduleTarget] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const qs = statusFilter ? `?status=${statusFilter}` : "";
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
  }, [statusFilter, reloadTick]);

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
      <button className={statusFilter === null ? "status-filter active" : "status-filter"} onClick={() => selectStatus(null)}>全部 {counts ? Object.values(counts).reduce((a, b) => a + b, 0) : ""}</button>
      {STATUS_ORDER.map((bucket) => (
        <button key={bucket} className={statusFilter === bucket ? `status-filter active status-b-${bucket}` : `status-filter status-b-${bucket}`} onClick={() => selectStatus(bucket)}>
          {STATUS_LABELS[bucket]} {counts ? counts[bucket] : ""}
        </button>
      ))}
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
              <span className={`status-pill status-b-${b.statusBucket}`}>{STATUS_LABELS[b.statusBucket]}</span>
              <span className="order-actions">
                {canManage && b.statusBucket === "hold" && <button onClick={() => runAction(b.id, "confirm")}>確認</button>}
                {canManage && (b.statusBucket === "hold" || b.statusBucket === "confirmed") && <button onClick={() => runAction(b.id, "cancel")}>取消</button>}
                {canManage && (b.statusBucket === "hold" || b.statusBucket === "confirmed") && <button onClick={() => openReschedule(b.id)}>改期</button>}
                {canCheckIn && b.statusBucket === "confirmed" && <button onClick={() => runAction(b.id, "check_in")}>報到</button>}
                {canManage && b.statusBucket === "arrived" && <button onClick={() => runAction(b.id, "complete")}>完成</button>}
                {canManage && b.statusBucket !== "cancelled" && <button onClick={() => openPayment(b.id)}>收款</button>}
              </span>
            </div>
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
  id: string; recordKind: "hourly_summary" | "legacy_run"; triggerSource: string; startedAt: string; completedAt: string | null;
  dueCount: number; sentCount: number; failedCount: number; blockedCount: number;
  oldestPendingSeconds: number | null; errorSummary: string | null;
};
type JobStatus = {
  jobName: string; lastCronObservedAt: string | null; lastRunAt: string | null; lastRunTriggerSource: string | null; lastRunCompletedAt: string | null;
  oldestPendingSeconds: number | null; deadLetterCount: number; recentRuns: JobRun[];
  alerts: { heartbeatMissed: boolean; backlogTooOld: boolean; hasCredentialErrors: boolean; hasExecutionErrors: boolean; hasDeadLetters: boolean; thresholds: { heartbeatMissedMinutes: number; backlogTooOldSeconds: number } };
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
  const anyAlert = status.alerts.heartbeatMissed || status.alerts.backlogTooOld || status.alerts.hasCredentialErrors || status.alerts.hasExecutionErrors || status.alerts.hasDeadLetters;
  return (
    <div className="job-status-card">
      <div className="job-status-head">
        <strong>{label}</strong>
        {anyAlert ? <span className="job-alert-pill alert"><AlertTriangle size={12} /> 需注意</span> : <span className="job-alert-pill ok"><CheckCircle2 size={12} /> 正常</span>}
      </div>
      <div className="job-status-grid">
        <span>排程最後確認</span><span>{status.lastCronObservedAt ? dateTimeFmt.format(new Date(status.lastCronObservedAt)) : "尚無排程完成紀錄"}</span>
        <span>最舊積壓</span><span>{status.oldestPendingSeconds === null ? "無積壓" : `${Math.round(status.oldestPendingSeconds / 60)} 分鐘`}</span>
        <span>需人工處理</span><span>{status.deadLetterCount} 筆{status.deadLetterCount > 0 && <button className="secondary-button" disabled={retrying} onClick={retryFailed}>{retrying ? "重試中…" : "全部重試"}</button>}</span>
      </div>
      {status.alerts.heartbeatMissed && <div className="job-alert-line">⚠ 超過 {status.alerts.thresholds.heartbeatMissedMinutes} 分鐘沒有排程完成快照（每小時記錄，請檢查排程或記錄寫入）</div>}
      {status.alerts.backlogTooOld && <div className="job-alert-line">⚠ 最舊待處理事件已等待超過 {Math.round(status.alerts.thresholds.backlogTooOldSeconds / 60)} 分鐘</div>}
      {status.alerts.hasExecutionErrors && <div className="job-alert-line">⚠ 最近有工作執行錯誤，請檢查 Workers 記錄與待處理項目</div>}
      {status.alerts.hasCredentialErrors && <div className="job-alert-line">⚠ 最近有憑證或連線設定問題，需要人工確認</div>}
      <table className="job-runs-table">
        <thead><tr><th>時段／時間</th><th>來源／類型</th><th>待處理峰值*</th><th>成功</th><th>失敗</th><th>阻塞</th></tr></thead>
        <tbody>
          {status.recentRuns.length === 0 && <tr><td colSpan={6}>尚無執行紀錄</td></tr>}
          {status.recentRuns.map((r) => (
            <tr key={r.id}>
              <td>{dateTimeFmt.format(new Date(r.startedAt))}</td>
              <td>{r.triggerSource === "cron" ? "排程" : "手動"}／{r.recordKind === "hourly_summary" ? "小時摘要" : "舊單次"}</td>
              <td>{r.dueCount}</td><td>{r.sentCount}</td><td>{r.failedCount}</td><td>{r.blockedCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>* 小時摘要為待處理峰值與實際處理結果累計；舊單次列為該次待處理數。空跑只留每小時快照，不代表每分鐘監測。</p>
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
      <div className="admin-section-title"><div><h2>排程與同步狀態</h2><p>LINE 提醒與 Sales 同步的每小時執行快照、實際處理累計與目前積壓。手動執行不會刷新排程健康狀態。</p></div>
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
    <div className="admin-section"><h2>待正式核定</h2><ul className="checklist"><li>成人、兒童與幼兒票價及年齡</li><li>付款保留時間（開發預設 10 分鐘）</li><li>前一天提醒時間（開發預設 18:00，提醒會排入佇列但 LINE Messaging API 憑證未設定，不會真的送出）</li><li>地址、導航、雨天、取消與退款政策</li><li>LINE／金流／Google Calendar 憑證</li><li>Sales 同步（outbox＋job已完整實作，Sales端接收API未部署）</li></ul></div>
    <JobStatusPanel />
  </div>;
}

function Metric({ icon, label, value, note, alert }: { icon: React.ReactNode; label: string; value: string; note: string; alert?: boolean }) {
  return <div className={alert ? "metric alert" : "metric"}><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>;
}

function Session({ time, detail, tone }: { time: string; detail: string; tone: string }) {
  return <div className={`calendar-session ${tone}`}><Clock3 /><strong>{time}</strong><span>{detail}</span></div>;
}
