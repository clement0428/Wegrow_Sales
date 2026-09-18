"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign,
  Clock3, RefreshCw, Settings2, TicketCheck, Users, XCircle,
} from "lucide-react";

type AdminSession = {
  id: string; startsAt: string; endsAt: string; status: string; experience: string;
  maxGroups: number; peopleLimit: number;
  confirmedGroups: number; confirmedPeople: number;
  requestedGroups: number; requestedPeople: number; pendingPaymentGroups: number;
  activeGroups: number; activePeople: number;
};

type StatusBucket = "hold" | "pending_payment" | "confirmed" | "arrived" | "completed" | "cancelled" | "exception";
const STATUS_LABELS: Record<StatusBucket, string> = {
  hold: "暫留", pending_payment: "待付款", confirmed: "已確認", arrived: "已到場",
  completed: "已完成", cancelled: "已取消", exception: "異常",
};
const STATUS_ORDER: StatusBucket[] = ["hold", "pending_payment", "confirmed", "arrived", "completed", "cancelled", "exception"];

type AdminBooking = {
  id: string; bookingNumber: string; lookupCode: string; contactName: string; contactPhone: string;
  groupName: string; totalPeople: number; amountTwd: number; bookingStatus: string; paymentStatus: string;
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

export default function FarmAdmin({ adminDisplayName }: { adminDisplayName: string }) {
  const [tab, setTab] = useState<"calendar" | "orders" | "settings">("calendar");
  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-logo"><Image src="/brand/wegrow-logo.png" width={50} height={50} alt="WeGrow" /><span><strong>WeGrow</strong><small>農場預約管理</small></span></div>
        <nav>
          <button className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}><CalendarDays />接待行事曆</button>
          <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><TicketCheck />預約與訂單</button>
          <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}><Settings2 />營運設定</button>
        </nav>
        <Link href="/"><ArrowLeft />回到客戶預約頁</Link>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar"><div><span className="section-kicker">WEGROW FARM OPERATIONS</span><h1>{tab === "calendar" ? "接待行事曆" : tab === "orders" ? "預約與訂單" : "營運設定"}</h1></div><span className="admin-whoami">管理員：{adminDisplayName}</span></header>

        <div className="environment-warning"><AlertTriangle /><span><strong>部分功能未正式開通</strong> LINE Messaging API、LINE Pay、信用卡與 Google Calendar 尚未設定正式憑證；目前不接受真實付款，提醒僅會排入佇列但不會真的送出。</span></div>

        {tab === "calendar" && <CalendarView />}
        {tab === "orders" && <OrdersView />}
        {tab === "settings" && <SettingsView />}
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

function OrdersView() {
  const [statusFilter, setStatusFilter] = useState<StatusBucket | null>(null);
  const [counts, setCounts] = useState<Record<StatusBucket, number> | null>(null);
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [reloadTick, setReloadTick] = useState(0);
  const retry = useCallback(() => { setState("loading"); setReloadTick((n) => n + 1); }, []);
  const selectStatus = useCallback((bucket: StatusBucket | null) => { setState("loading"); setStatusFilter(bucket); }, []);

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
        <div className="order-row order-head"><span>訂單</span><span>聯絡人</span><span>時段</span><span>人數</span><span>狀態</span><span>操作</span></div>
        {state === "loading" && <div className="empty-admin"><RefreshCw className="spin" /><strong>載入中…</strong></div>}
        {state === "ready" && (bookings ?? []).length === 0 && <div className="empty-admin"><TicketCheck /><strong>這個篩選條件下沒有訂單</strong></div>}
        {(bookings ?? []).map((b) => (
          <div className="order-row" key={b.id}>
            <strong>{b.bookingNumber}</strong>
            <span>{b.contactName}{b.groupName ? `（${b.groupName}）` : ""}</span>
            <span>{dateFmt.format(new Date(b.startsAt))} {timeFmt.format(new Date(b.startsAt))}</span>
            <span>{b.totalPeople} 位</span>
            <span className={`status-pill status-b-${b.statusBucket}`}>{STATUS_LABELS[b.statusBucket]}</span>
            <span className="order-actions">
              {b.statusBucket === "hold" && <button onClick={() => runAction(b.id, "confirm")}>確認</button>}
              {(b.statusBucket === "hold" || b.statusBucket === "confirmed") && <button onClick={() => runAction(b.id, "cancel")}>取消</button>}
              {b.statusBucket === "confirmed" && <button onClick={() => runAction(b.id, "check_in")}>報到</button>}
              {b.statusBucket === "arrived" && <button onClick={() => runAction(b.id, "complete")}>完成</button>}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>;
}

function SettingsView() {
  return <div className="settings-columns">
    <div className="admin-section"><h2>容量政策</h2><p>此規則已依使用者確認固定；變更時建立新版本，不回寫舊訂單。</p><div className="policy-list"><label>每時段總人數上限<input value="30" readOnly /></label><label>每時段最多團數<input value="2" readOnly /></label></div><div className="verified-line"><CheckCircle2 />規則版本 V2：每時段 30 人／最多 2 團，不分團數分級</div></div>
    <div className="admin-section"><h2>待正式核定</h2><ul className="checklist"><li>成人、兒童與幼兒票價及年齡</li><li>付款保留時間（開發預設 10 分鐘）</li><li>前一天提醒時間（開發預設 18:00，提醒會排入佇列但 LINE Messaging API 憑證未設定，不會真的送出）</li><li>地址、導航、雨天、取消與退款政策</li><li>LINE／金流／Google Calendar 憑證</li><li>Sales 同步（outbox 表已建立，尚未接上真正的 Sales API）</li></ul></div>
  </div>;
}

function Metric({ icon, label, value, note, alert }: { icon: React.ReactNode; label: string; value: string; note: string; alert?: boolean }) {
  return <div className={alert ? "metric alert" : "metric"}><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>;
}

function Session({ time, detail, tone }: { time: string; detail: string; tone: string }) {
  return <div className={`calendar-session ${tone}`}><Clock3 /><strong>{time}</strong><span>{detail}</span></div>;
}
