"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Plus, ChevronDown, Check } from "lucide-react";
import type { Venue } from "@/lib/db/types";
import type { EventInput } from "@/lib/schemas/event";
import { createVenue } from "@/lib/actions/venues";
import { defaultDeadline, hm } from "@/lib/time";

type Props = {
  venues: Venue[];
  initial?: Partial<EventInput>;
  submitLabel: string;
  onSubmit: (input: EventInput) => Promise<void>;
};

const eyebrow = "text-[10.5px] font-bold tracking-[.08em] uppercase text-[var(--primary)] mb-1.5";
const cardCls = "bg-[var(--surface)] rounded-[16px] px-3.5 pt-3.5 pb-3 shadow-[0_2px_6px_rgba(27,26,23,.06),0_8px_20px_rgba(27,26,23,.06)]";
const inputCls = "w-full border-0 bg-transparent font-display font-semibold text-[17px] text-[var(--ink)] outline-none py-0.5 tabular";

function tomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function EventForm({ venues: initialVenues, initial, submitLabel, onSubmit }: Props) {
  const [venues, setVenues] = useState(initialVenues);
  const defaultDate = initial?.event_date || tomorrowISO();
  const defaultStart = initial?.start_time || "19:00";
  const defaultEnd = initial?.end_time || "21:00";
  const defaultDl = initial?.registration_deadline || defaultDeadline(defaultDate, defaultStart).slice(0, 16);
  const [f, setF] = useState<EventInput>({
    title: initial?.title ?? "",
    event_date: defaultDate,
    start_time: defaultStart,
    end_time: defaultEnd,
    registration_deadline: defaultDl,
    venue_id: initial?.venue_id ?? "",
    capacity: initial?.capacity ?? 8,
    estimated_total: initial?.estimated_total,
    note: initial?.note ?? "",
  });
  const [deadlineTouched, setDeadlineTouched] = useState(!!initial?.registration_deadline);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  // Inline "add new venue" state
  const [showNewVenue, setShowNewVenue] = useState(false);
  const [newVenueName, setNewVenueName] = useState("");
  const [newVenueAddress, setNewVenueAddress] = useState("");
  const [creatingVenue, setCreatingVenue] = useState(false);

  // Custom venue dropdown (native <select> popups render off-position in the desktop phone-frame preview)
  const [venueOpen, setVenueOpen] = useState(false);
  const venueWrapRef = useRef<HTMLDivElement>(null);
  const venueMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!venueOpen) return;
    venueMenuRef.current?.scrollIntoView({ block: "nearest" });
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (venueWrapRef.current && !venueWrapRef.current.contains(e.target as Node)) setVenueOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setVenueOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [venueOpen]);
  const selectableVenues = venues.filter((v) => v.is_active === 1 || v.id === f.venue_id);
  const selectedVenue = venues.find((v) => v.id === f.venue_id) ?? null;

  const perPerson = f.estimated_total && f.capacity ? Math.ceil(Number(f.estimated_total) / f.capacity) : null;
  const totalEstimate = f.estimated_total ?? 0;

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]) => {
    const next = { ...f, [k]: v };
    if (!deadlineTouched && next.event_date && next.start_time) next.registration_deadline = defaultDeadline(next.event_date, next.start_time).slice(0, 16);
    setF(next);
  };
  const capStep = (delta: number) => {
    const cap = Math.max(1, Math.min(100, Number(f.capacity) + delta));
    setF({ ...f, capacity: cap });
  };

  const addVenue = async () => {
    const name = newVenueName.trim();
    if (!name) { setErr("球場名稱不能空白"); return; }
    setErr("");
    setCreatingVenue(true);
    try {
      const created = await createVenue(name, newVenueAddress.trim() || undefined);
      setVenues((prev) => [...prev, created]);
      setF((prev) => ({ ...prev, venue_id: created.id }));
      setNewVenueName(""); setNewVenueAddress(""); setShowNewVenue(false);
    } catch (e) { setErr((e as Error).message); }
    setCreatingVenue(false);
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setErr("");
        if (!f.venue_id) { setErr("請選擇球場"); return; }
        start(async () => {
          try {
            await onSubmit({ ...f, start_time: hm(f.start_time), end_time: hm(f.end_time) });
          } catch (x) { setErr((x as Error).message); }
        });
      }}
    >
      <div className={cardCls}>
        <div className={eyebrow}>場次名稱</div>
        <input className={inputCls} required value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="例：週三夜打" />
      </div>

      {/* 名額 column is auto-width so the iOS date input's intrinsic width can never push it out of the row */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <div className={`${cardCls} min-w-0`}>
          <div className={eyebrow}>日期</div>
          <input className={`${inputCls} min-w-0`} type="date" required value={f.event_date} onChange={(e) => set("event_date", e.target.value)} />
        </div>
        <div className={cardCls}>
          <div className={eyebrow}>名額</div>
          <div className="flex items-center justify-center gap-1.5">
            <button type="button" onClick={() => capStep(-1)}
              aria-label="減少名額"
              className="press w-8 h-8 rounded-[10px] font-display font-extrabold text-[18px] leading-none flex items-center justify-center shrink-0"
              style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
            >−</button>
            <input
              type="number" inputMode="numeric" min={1} max={100}
              className="w-10 tabular font-display font-extrabold text-[22px] leading-none text-center bg-transparent border-0 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              value={f.capacity}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                const cap = Math.max(1, Math.min(100, n));
                setF({ ...f, capacity: cap });
              }}
            />
            <button type="button" onClick={() => capStep(1)}
              aria-label="增加名額"
              className="press w-8 h-8 rounded-[10px] font-display font-extrabold text-[18px] leading-none flex items-center justify-center shrink-0"
              style={{ background: "var(--primary-soft)", color: "var(--primary)" }}
            >+</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className={cardCls}>
          <div className={eyebrow}>開始</div>
          <input className={inputCls} type="time" required value={f.start_time} onChange={(e) => set("start_time", e.target.value)} />
        </div>
        <div className={cardCls}>
          <div className={eyebrow}>結束</div>
          <input className={inputCls} type="time" required value={f.end_time} onChange={(e) => set("end_time", e.target.value)} />
        </div>
      </div>

      <div className={cardCls}>
        <div className={eyebrow}>退出截止時間</div>
        <input
          className={inputCls} type="datetime-local" required
          value={f.registration_deadline}
          onChange={(e) => { setDeadlineTouched(true); setF({ ...f, registration_deadline: e.target.value }); }}
        />
        <p className="mt-1 text-[10.5px] text-[var(--ink-3)]">預設為活動前一天。超過後仍可繼續加入，但已報名的人不能再退出</p>
      </div>

      <div className={cardCls}>
        <div className="flex items-baseline justify-between">
          <div className={eyebrow}>場地</div>
          {!showNewVenue && (
            <button type="button" onClick={() => { setVenueOpen(false); setShowNewVenue(true); }}
              className="press inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--primary)]"
            >
              <Plus className="w-3 h-3" />新增場地
            </button>
          )}
        </div>
        {showNewVenue ? (
          <div className="mt-1 space-y-2">
            <input
              className="w-full rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none border-0 placeholder:text-[var(--ink-3)]"
              placeholder="新球場名稱"
              value={newVenueName}
              onChange={(e) => setNewVenueName(e.target.value)}
              maxLength={60}
            />
            <input
              className="w-full rounded-[10px] bg-[var(--surface-2)] px-3 py-2 text-[14px] outline-none border-0 placeholder:text-[var(--ink-3)]"
              placeholder="地址（選填）"
              value={newVenueAddress}
              onChange={(e) => setNewVenueAddress(e.target.value)}
              maxLength={200}
            />
            <div className="flex gap-2">
              <button type="button" onClick={addVenue} disabled={creatingVenue || !newVenueName.trim()}
                className="press flex-1 h-9 rounded-[10px] font-semibold text-[13px] disabled:opacity-50"
                style={{ background: "var(--primary)", color: "var(--primary-ink)" }}
              >{creatingVenue ? "建立中…" : "加入清單並選用"}</button>
              <button type="button" onClick={() => { setShowNewVenue(false); setNewVenueName(""); setNewVenueAddress(""); }}
                className="press h-9 px-3 rounded-[10px] font-semibold text-[13px] border border-[var(--line)] text-[var(--ink-2)]"
              >取消</button>
            </div>
          </div>
        ) : (
          <div ref={venueWrapRef} className="relative">
            <button
              type="button"
              onClick={() => setVenueOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={venueOpen}
              className={inputCls + " flex items-center justify-between gap-2 text-left cursor-pointer"}
            >
              <span className="truncate" style={selectedVenue ? undefined : { color: "var(--ink-3)" }}>
                {selectedVenue ? selectedVenue.name : "選擇球場"}
              </span>
              <ChevronDown
                className="w-[18px] h-[18px] shrink-0 transition-transform"
                style={{ color: "var(--ink-3)", transform: venueOpen ? "rotate(180deg)" : undefined }}
                strokeWidth={2.2}
              />
            </button>
            {venueOpen && (
              <div
                ref={venueMenuRef}
                role="listbox"
                className="absolute left-0 right-0 top-full mt-1.5 z-30 rounded-[14px] p-1.5 border border-[var(--line)] max-h-[264px] overflow-y-auto no-scrollbar"
                style={{ background: "var(--surface)", boxShadow: "var(--shadow-2)" }}
              >
                {selectableVenues.length === 0 && (
                  <div className="px-3 py-2.5 text-[13px] text-[var(--ink-3)]">還沒有場地，先按右上「新增場地」</div>
                )}
                {selectableVenues.map((v) => {
                  const active = v.id === f.venue_id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => { setF((prev) => ({ ...prev, venue_id: v.id })); setVenueOpen(false); }}
                      className="press w-full flex items-center gap-2 rounded-[10px] px-3 py-2.5 text-[14px] font-semibold text-left"
                      style={active ? { background: "var(--primary-soft)", color: "var(--primary)" } : { color: "var(--ink)" }}
                    >
                      <span className="flex-1 truncate">{v.name}</span>
                      {active && <Check className="w-4 h-4 shrink-0" strokeWidth={2.6} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cardCls}>
        <div className="flex justify-between items-baseline">
          <div className={eyebrow}>預計總金額（選填）</div>
          <div className="text-[10.5px] text-[var(--ink-3)]">
            預估每人 <b className="tabular text-[var(--ink)]">${perPerson ?? 0}</b>
          </div>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--ink-3)]">NT$</span>
          <input className={inputCls} type="number" min={0} placeholder="0" value={f.estimated_total ?? ""} onChange={(e) => set("estimated_total", e.target.value === "" ? undefined : Number(e.target.value))} />
        </div>
        <p className="mt-1 text-[10.5px] text-[var(--ink-3)]">實際人數確定後再結算鎖定，共 ${totalEstimate}</p>
      </div>

      <div className={cardCls}>
        <div className={eyebrow}>備註（可選）</div>
        <textarea className={`${inputCls} resize-none font-medium text-[14px]`} rows={3} placeholder="交通、費用、天氣備案…" value={f.note ?? ""} onChange={(e) => set("note", e.target.value)} />
      </div>

      {err && <p className="text-[13px] text-center" style={{ color: "var(--danger)" }}>{err}</p>}

      <button disabled={pending}
        className="press w-full h-12 rounded-[14px] font-display font-extrabold text-[15.5px] mt-1 disabled:opacity-60"
        style={{ background: "var(--primary)", color: "var(--primary-ink)", boxShadow: "0 6px 16px color-mix(in oklab, var(--primary) 35%, transparent)" }}
      >
        {pending ? "處理中…" : submitLabel}
      </button>
    </form>
  );
}
