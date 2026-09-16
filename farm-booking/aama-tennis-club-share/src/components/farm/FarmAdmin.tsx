"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, CircleDollarSign,
  Clock3, Download, Settings2, TicketCheck, Users,
} from "lucide-react";

const bookings = [
  { id: "WG-260919-001", contact: "王小姐家庭", time: "09:30", people: 6, status: "待付款", payment: "LINE Pay" },
  { id: "WG-260919-002", contact: "禾日設計", time: "14:00", people: 20, status: "已確認", payment: "信用卡" },
  { id: "WG-260920-001", contact: "親子小組 A", time: "09:30", people: 5, status: "已確認", payment: "LINE Pay" },
  { id: "WG-260920-002", contact: "親子小組 B", time: "09:30", people: 5, status: "退款處理中", payment: "信用卡" },
];

export default function FarmAdmin() {
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
        <header className="admin-topbar"><div><span className="section-kicker">WEGROW FARM OPERATIONS</span><h1>{tab === "calendar" ? "接待行事曆" : tab === "orders" ? "預約與訂單" : "營運設定"}</h1></div><button className="secondary-button"><Download /> 匯出接待表</button></header>

        <div className="environment-warning"><AlertTriangle /><span><strong>開發環境</strong> LINE、LINE Pay、信用卡與 Google Calendar 尚未設定正式憑證；目前不接受真實付款或發送通知。</span></div>

        {tab === "calendar" && <CalendarView />}
        {tab === "orders" && <OrdersView />}
        {tab === "settings" && <SettingsView />}
      </section>
    </main>
  );
}

function CalendarView() {
  return <>
    <div className="admin-metrics">
      <Metric icon={<CalendarDays />} label="本週開放場次" value="4" note="3 個日期" />
      <Metric icon={<Users />} label="已確認來訪" value="30" note="3 團" />
      <Metric icon={<CircleDollarSign />} label="淨收款" value="待設定" note="票價尚未核定" />
      <Metric icon={<AlertTriangle />} label="需要處理" value="2" note="付款 1／退款 1" alert />
    </div>
    <div className="admin-section">
      <div className="admin-section-title"><div><h2>2026 年 9 月</h2><p>一眼看每時段團數與總人數，不用固定 50 人當分母。</p></div><button className="secondary-button">新增開放時段</button></div>
      <div className="week-grid">
        {["一 14", "二 15", "三 16", "四 17", "五 18", "六 19", "日 20"].map((day, index) => <div key={day} className={index > 4 ? "day weekend" : "day"}><strong>{day}</strong>{index === 5 && <><Session time="09:30" detail="0 團／0 人" tone="open" /><Session time="14:00" detail="1 團／20 人" tone="busy" /></>}{index === 6 && <Session time="09:30" detail="2 團／10 人" tone="full" />}</div>)}
      </div>
    </div>
    <div className="admin-section"><h2>今日接待</h2><div className="empty-admin"><CalendarDays /><strong>今天沒有已確認來訪</strong><span>下一場為 9/19 09:30。</span></div></div>
  </>;
}

function OrdersView() {
  return <div className="admin-section">
    <div className="admin-section-title"><div><h2>預約訂單</h2><p>預約狀態與付款狀態分開，不用付款成功假裝預約一定成立。</p></div><input className="admin-search" placeholder="搜尋訂單或聯絡人" /></div>
    <div className="order-table">
      <div className="order-row order-head"><span>訂單</span><span>聯絡人</span><span>時段</span><span>人數</span><span>付款方式</span><span>狀態</span></div>
      {bookings.map((booking) => <div className="order-row" key={booking.id}><strong>{booking.id}</strong><span>{booking.contact}</span><span>{booking.time}</span><span>{booking.people} 位</span><span>{booking.payment}</span><span className={`status-pill status-${booking.status}`}>{booking.status}</span></div>)}
    </div>
  </div>;
}

function SettingsView() {
  return <div className="settings-columns">
    <div className="admin-section"><h2>容量政策</h2><p>此規則已依使用者確認固定；變更時建立新版本，不回寫舊訂單。</p><div className="policy-list"><label>1 團總人數上限<input value="50" readOnly /></label><label>2 團總人數上限<input value="30" readOnly /></label><label>3 團總人數上限<input value="15" readOnly /></label></div><div className="verified-line"><CheckCircle2 />規則版本 V1：50／30／15</div></div>
    <div className="admin-section"><h2>待正式核定</h2><ul className="checklist"><li>成人、兒童與幼兒票價及年齡</li><li>付款保留時間（開發預設 15 分鐘）</li><li>前一天提醒時間（開發預設 18:00）</li><li>地址、導航、雨天、取消與退款政策</li><li>LINE／金流／Google Calendar 憑證</li></ul></div>
  </div>;
}

function Metric({ icon, label, value, note, alert }: { icon: React.ReactNode; label: string; value: string; note: string; alert?: boolean }) {
  return <div className={alert ? "metric alert" : "metric"}><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></div>;
}

function Session({ time, detail, tone }: { time: string; detail: string; tone: string }) {
  return <div className={`calendar-session ${tone}`}><Clock3 /><strong>{time}</strong><span>{detail}</span></div>;
}
