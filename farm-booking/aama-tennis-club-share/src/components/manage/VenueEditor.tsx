"use client";
import { useState, useTransition } from "react";
import { Plus, Pencil, Check, X, MapPin } from "lucide-react";
import { createVenue, updateVenue } from "@/lib/actions/venues";
import type { Venue } from "@/lib/db/types";

const cardCls = "bg-[var(--surface)] rounded-[16px] p-3.5 shadow-[var(--shadow-1)]";
const inputCls = "w-full border-0 bg-[var(--surface-2)] rounded-[10px] px-3 py-2 text-[14px] text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]";
const primaryBtn = "press h-10 rounded-[12px] font-display font-extrabold text-[14px] px-4 disabled:opacity-50";
const ghostBtn = "press h-10 rounded-[12px] font-semibold text-[13px] px-3 border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] flex items-center gap-1.5";

export default function VenueEditor({ venues }: { venues: Venue[] }) {
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const active = venues.filter((v) => v.is_active === 1);
  const inactive = venues.filter((v) => v.is_active !== 1);

  const beginEdit = (v: Venue) => {
    setEditingId(v.id);
    setEditName(v.name);
    setEditAddress(v.address ?? "");
    setErr("");
  };
  const saveEdit = () => {
    if (!editingId) return;
    const n = editName.trim();
    if (!n) { setErr("場地名稱不能空白"); return; }
    setErr("");
    start(async () => {
      try {
        await updateVenue(editingId, { name: n, address: editAddress.trim() || null });
        setEditingId(null);
      } catch (e) { setErr((e as Error).message); }
    });
  };
  const addNew = () => {
    const n = name.trim();
    if (!n) { setErr("場地名稱不能空白"); return; }
    setErr("");
    start(async () => {
      try {
        await createVenue(n, address.trim() || undefined);
        setName(""); setAddress(""); setShowNew(false);
      } catch (e) { setErr((e as Error).message); }
    });
  };
  const toggleActive = (v: Venue) => start(() => updateVenue(v.id, { is_active: v.is_active !== 1 }));

  return (
    <div className="space-y-3">
      {/* New venue */}
      {showNew ? (
        <div className={cardCls}>
          <div className="text-[10.5px] font-bold tracking-[.08em] uppercase text-[var(--primary)] mb-2">新增場地</div>
          <input className={inputCls} placeholder="球場名稱，例如：大安網球場 A 場" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          <input className={`${inputCls} mt-2`} placeholder="地址（選填），例如：台北市大安區建國南路" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} />
          <div className="flex gap-2 mt-3">
            <button className={primaryBtn + " flex-1"} style={{ background: "var(--primary)", color: "var(--primary-ink)" }}
              onClick={addNew} disabled={pending || !name.trim()}>新增</button>
            <button className={ghostBtn} onClick={() => { setShowNew(false); setName(""); setAddress(""); setErr(""); }} disabled={pending}>取消</button>
          </div>
        </div>
      ) : (
        <button className="press w-full rounded-[16px] p-3 border border-dashed border-[var(--line)] text-[13px] font-semibold text-[var(--ink-2)] flex items-center justify-center gap-1.5 bg-[color-mix(in_oklab,var(--surface)_60%,transparent)]"
          onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" />新增場地
        </button>
      )}

      {err && <p className="text-[12.5px] text-center" style={{ color: "var(--danger)" }}>{err}</p>}

      {/* Active venues */}
      <div className="space-y-2">
        {active.map((v) => {
          const editing = editingId === v.id;
          return (
            <div key={v.id} className={cardCls}>
              {editing ? (
                <>
                  <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={60} placeholder="球場名稱" />
                  <input className={`${inputCls} mt-2`} value={editAddress} onChange={(e) => setEditAddress(e.target.value)} maxLength={200} placeholder="地址（選填）" />
                  <div className="flex gap-2 mt-3">
                    <button className={primaryBtn + " flex-1 flex items-center justify-center gap-1"} style={{ background: "var(--primary)", color: "var(--primary-ink)" }} onClick={saveEdit} disabled={pending}>
                      <Check className="w-4 h-4" />儲存
                    </button>
                    <button className={ghostBtn} onClick={() => { setEditingId(null); setErr(""); }} disabled={pending}>
                      <X className="w-4 h-4" />取消
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                    <MapPin className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-semibold truncate">{v.name}</div>
                    <div className="text-[12px] text-[var(--ink-3)] mt-0.5 truncate">{v.address || "尚未填地址"}</div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <button className="press text-[12px] font-semibold text-[var(--primary)] flex items-center gap-1" onClick={() => beginEdit(v)} disabled={pending}>
                      <Pencil className="w-3.5 h-3.5" />編輯
                    </button>
                    <button className="press text-[11.5px] text-[var(--ink-3)]" onClick={() => toggleActive(v)} disabled={pending}>停用</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {active.length === 0 && (
          <p className="py-8 text-center text-[var(--ink-3)] text-sm">還沒有任何場地，按上方新增一個</p>
        )}
      </div>

      {inactive.length > 0 && (
        <>
          <div className="text-[10.5px] font-bold tracking-[.08em] uppercase text-[var(--ink-3)] mt-6 mb-2 px-1">已停用</div>
          <div className="space-y-2">
            {inactive.map((v) => (
              <div key={v.id} className={cardCls} style={{ opacity: 0.7 }}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold truncate text-[var(--ink-2)] line-through">{v.name}</div>
                    {v.address && <div className="text-[11.5px] text-[var(--ink-3)] mt-0.5 truncate">{v.address}</div>}
                  </div>
                  <button className="press text-[12px] font-semibold text-[var(--primary)]" onClick={() => toggleActive(v)} disabled={pending}>啟用</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
