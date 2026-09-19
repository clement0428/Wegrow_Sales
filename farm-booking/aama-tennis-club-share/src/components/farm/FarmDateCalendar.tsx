"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, UserCheck } from "lucide-react";
import type { Slot } from "./FarmBookingApp";

// 規格 2A 節「客戶日曆狀態列」：可預約｜已有預約｜暫留｜額滿🔒｜未開放｜我的預約。
// Computed entirely from the existing /api/farm/availability response (which
// already includes confirmedGroupCount/holdGroupCount per slot) plus an
// optional /api/farm/bookings?mine=1 fetch for the "我的預約" marker — no new
// endpoint needed for the first five states.
type DayStatus = "available" | "has_group" | "full" | "not_open" | "past";

const monthLabel = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", timeZone: "Asia/Taipei" });
const dayNumFmt = new Intl.DateTimeFormat("zh-TW", { day: "numeric", timeZone: "Asia/Taipei" });
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" });
const WEEKDAY_HEADS = ["一", "二", "三", "四", "五", "六", "日"];

function dayKey(d: Date): string { return dayKeyFmt.format(d); }
function startOfMonth(d: Date): Date { const t = new Date(d); t.setDate(1); return t; }
function addMonths(d: Date, n: number): Date { const t = new Date(d); t.setMonth(t.getMonth() + n); return t; }
function addDays(d: Date, n: number): Date { const t = new Date(d); t.setDate(t.getDate() + n); return t; }
function mondayOf(d: Date): Date {
  const t = new Date(d);
  const day = t.getDay();
  t.setDate(t.getDate() + (day === 0 ? -6 : 1 - day));
  return t;
}

export default function FarmDateCalendar({
  slots, activeDate, onSelectDate, showMine,
}: {
  slots: Slot[];
  activeDate: string;
  onSelectDate: (key: string) => void;
  showMine: boolean;
}) {
  const [mode, setMode] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [mineDates, setMineDates] = useState<Set<string>>(new Set());

  // Only ever fetch and resolve via .then()/.catch(); no synchronous setState
  // in the effect body (React's set-state-in-effect lint rule). showMine
  // going false leaves any existing markers in place — mineDates starts at
  // its initial empty Set for the common case where it's never true.
  useEffect(() => {
    if (!showMine) return;
    const controller = new AbortController();
    fetch("/api/farm/bookings?mine=1", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json() as { bookings?: Array<{ startsAt: string }> };
        setMineDates(new Set((data.bookings ?? []).map((b) => dayKeyFmt.format(new Date(b.startsAt)))));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [showMine]);

  const byDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = dayKeyFmt.format(new Date(slot.startsAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    }
    return map;
  }, [slots]);

  function statusOf(key: string): DayStatus {
    const today = dayKey(new Date());
    if (key < today) return "past";
    const daySlots = byDay.get(key);
    if (!daySlots || daySlots.length === 0) return "not_open";
    if (daySlots.some((s) => s.available)) {
      return daySlots.some((s) => s.confirmedGroupCount > 0 || s.holdGroupCount > 0) ? "has_group" : "available";
    }
    return "full";
  }

  const days = useMemo(() => {
    if (mode === "week") {
      const start = mondayOf(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    const first = startOfMonth(cursor);
    const gridStart = mondayOf(first);
    // 6 weeks always covers any month regardless of where it starts/ends.
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [mode, cursor]);

  return (
    <div className="farm-calendar">
      <div className="calendar-legend">
        <span className="legend-item legend-available"><i /> 可預約</span>
        <span className="legend-item legend-has_group"><i /> 已有預約</span>
        <span className="legend-item legend-full"><Lock size={12} /> 額滿</span>
        <span className="legend-item legend-not_open"><i /> 未開放</span>
        {showMine && <span className="legend-item legend-mine"><UserCheck size={12} /> 我的預約</span>}
      </div>
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button aria-label="上一個" onClick={() => setCursor(mode === "month" ? addMonths(cursor, -1) : addDays(cursor, -7))}><ChevronLeft size={16} /></button>
          <strong>{mode === "month" ? monthLabel.format(cursor) : `${monthLabel.format(mondayOf(cursor))} 第 ${dayNumFmt.format(mondayOf(cursor))} 週起`}</strong>
          <button aria-label="下一個" onClick={() => setCursor(mode === "month" ? addMonths(cursor, 1) : addDays(cursor, 7))}><ChevronRight size={16} /></button>
        </div>
        <div className="calendar-mode-switch">
          <button className={mode === "month" ? "active" : ""} onClick={() => setMode("month")}>月</button>
          <button className={mode === "week" ? "active" : ""} onClick={() => setMode("week")}>週</button>
          <button onClick={() => { setCursor(new Date()); }}>今天</button>
        </div>
      </div>
      <div className={mode === "month" ? "calendar-grid month" : "calendar-grid week"}>
        {WEEKDAY_HEADS.map((w, i) => <div key={w} className={i >= 4 ? "calendar-head weekend-head" : "calendar-head"}>{w}</div>)}
        {days.map((d) => {
          const key = dayKey(d);
          const status = statusOf(key);
          const inMonth = mode === "week" || d.getMonth() === cursor.getMonth();
          const isMine = mineDates.has(key);
          const selectable = status === "available" || status === "has_group";
          // 週五六日特別配色（僅視覺）：鎖定狀態(額滿/未開放)優先，黃底只加在
          // available／has_group，不會蓋掉灰色鎖定樣式，也不改變任何可訂邏輯。
          const dow = d.getDay();
          const isWeekend = dow === 0 || dow === 5 || dow === 6;
          return (
            <button
              key={key}
              className={`calendar-cell status-${status}${key === activeDate ? " selected" : ""}${!inMonth ? " dim" : ""}${isMine ? " mine" : ""}${isWeekend ? " weekend" : ""}`}
              disabled={!selectable}
              onClick={() => selectable && onSelectDate(key)}
            >
              <span className="cell-num">{dayNumFmt.format(d)}</span>
              {status === "full" && <Lock size={11} className="cell-icon" />}
              {isMine && <UserCheck size={11} className="cell-icon mine-icon" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
