"use client";
import { useMemo, useState, useTransition } from "react";
import { Check, Plus, UserPlus2, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { settleEvent } from "@/lib/actions/settlement";
import { addAttendeeToEvent, organizerRemove } from "@/lib/actions/registrations";
import { computeSettlement } from "@/lib/domain/settlement";
import type { EventWithCounts, RegistrationWithMember, MemberLite } from "@/lib/db/queries";

type Props = {
  event: EventWithCounts;
  registrations: RegistrationWithMember[];
  candidates: MemberLite[];  // all members not already in the event
};

export default function SettlementSection({ event, registrations, candidates }: Props) {
  const settled = event.status === "settled";
  const [total, setTotal] = useState<number>(event.final_total ?? event.estimated_total ?? 0);

  // Default: 正取 all checked; 候補 all unchecked (or re-settle: whoever was attended)
  const [attended, setAttended] = useState<Set<string>>(() =>
    new Set(registrations.filter((r) => settled ? r.attended === 1 : r.status === "confirmed").map((r) => r.member_id))
  );
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const [query, setQuery] = useState("");
  const [addPending, addStart] = useTransition();

  const preview = useMemo(() => {
    try { return computeSettlement({ finalTotal: total, attendedMemberIds: [...attended] }); }
    catch (e) { return { error: (e as Error).message }; }
  }, [total, attended]);

  const toggle = (id: string) => {
    const s = new Set(attended);
    if (s.has(id)) s.delete(id); else s.add(id);
    setAttended(s);
  };

  const suggestion = query.trim().length > 0
    ? candidates.filter((m) => m.display_name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 5)
    : [];
  const noMatch = query.trim().length > 0 && suggestion.length === 0;

  const addExisting = (memberId: string) => {
    addStart(async () => {
      try { await addAttendeeToEvent(event.id, { memberId }); setQuery(""); }
      catch (e) { setErr((e as Error).message); }
    });
  };
  const addGuest = () => {
    addStart(async () => {
      try { await addAttendeeToEvent(event.id, { guestName: query.trim() }); setQuery(""); }
      catch (e) { setErr((e as Error).message); }
    });
  };

  return (
    <div className="rounded-[18px] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
      <h3 className="text-[15px] font-bold">{settled ? "重新結算" : "結算名單"}</h3>
      <p className="mt-1 text-[11.5px] text-[var(--ink-3)]">勾選實際到場的人，可搜尋現有成員或新增客串。</p>

      {/* Roster with checkboxes + remove (only when open) */}
      <div className="mt-3 space-y-1.5">
        {registrations.map((r) => {
          const on = attended.has(r.member_id);
          const isWait = r.status === "waitlisted";
          return (
            <div key={r.id} className="flex items-center gap-3 rounded-[12px] px-2 py-1.5 hover:bg-[var(--surface-2)]">
              <button
                type="button"
                onClick={() => toggle(r.member_id)}
                className={`press w-6 h-6 rounded-[7px] flex items-center justify-center border-2 shrink-0 ${on ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--line)]"}`}
              >
                {on && <Check className="w-3.5 h-3.5" strokeWidth={3.5} />}
              </button>
              <Avatar name={r.member.display_name} src={r.member.picture_url} size={28} />
              <span className="flex-1 text-[13.5px] font-semibold">{r.member.display_name}</span>
              {isWait && <span className="text-[10px] font-bold text-[var(--primary)]">候補</span>}
              {!settled && (
                <button
                  type="button"
                  disabled={addPending}
                  onClick={() => addStart(async () => { try { await organizerRemove(event.id, r.member_id); } catch (e) { setErr((e as Error).message); } })}
                  className="press w-6 h-6 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)]"
                  title="移除"
                >
                  <X className="w-3.5 h-3.5 text-[var(--ink-3)]" strokeWidth={2.5} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Add member row */}
      {!settled && (
        <div className="mt-3">
          <div className="relative">
            <div className="flex items-center gap-2 rounded-[12px] bg-[var(--surface-2)] px-3 py-2">
              <UserPlus2 className="w-4 h-4 text-[var(--ink-3)]" />
              <input
                type="text"
                placeholder="搜尋成員或輸入名稱新增"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent border-0 outline-none text-[13.5px]"
              />
            </div>
            {(suggestion.length > 0 || noMatch) && (
              <div className="absolute left-0 right-0 mt-1 rounded-[12px] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-2)] z-10 max-h-56 overflow-y-auto no-scrollbar">
                {suggestion.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={addPending}
                    onClick={() => addExisting(m.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)]"
                  >
                    <Avatar name={m.display_name} src={m.picture_url} size={26} />
                    <span className="text-[13.5px] font-semibold flex-1">{m.display_name}</span>
                    <Plus className="w-3.5 h-3.5 text-[var(--ink-3)]" />
                  </button>
                ))}
                {noMatch && (
                  <button
                    type="button"
                    disabled={addPending}
                    onClick={addGuest}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)] text-[var(--primary)]"
                  >
                    <UserPlus2 className="w-3.5 h-3.5" />
                    <span className="text-[13.5px] font-semibold">新增「{query.trim()}」為客串</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Final total input */}
      <label className="mt-4 block text-[11px] font-bold text-[var(--primary)] tracking-[.08em] uppercase">實際總金額</label>
      <div className="mt-1 rounded-[12px] bg-[var(--surface-2)] px-3 py-2.5 flex items-baseline gap-1.5">
        <span className="text-[12px] font-semibold text-[var(--ink-3)]">NT$</span>
        <input
          type="number" min={0} placeholder="0"
          className="flex-1 bg-transparent border-0 outline-none font-display tabular font-bold text-[18px] text-[var(--ink)]"
          value={total || ""}
          onChange={(e) => setTotal(e.target.value === "" ? 0 : Number(e.target.value))}
        />
      </div>

      <div className="mt-3 rounded-[12px] bg-[var(--primary-soft)] p-3 text-[12.5px]">
        {"error" in preview ? (
          <p className="font-bold text-[var(--danger)]">{preview.error}</p>
        ) : (
          <>
            <p>到場 <b className="tabular">{attended.size}</b> 人，每人 <b className="tabular text-[var(--primary)]">${preview.perPerson}</b></p>
            <p className="text-[var(--ink-3)] mt-0.5">應收合計 ${preview.expectedIncome}，與實際總金額差 ${preview.diff}</p>
          </>
        )}
      </div>

      {err && <p className="mt-2 text-[13px] text-center text-[var(--danger)]">{err}</p>}

      <button
        disabled={pending || "error" in preview}
        className="press mt-3 w-full rounded-[14px] py-3 font-display font-extrabold text-[14.5px] disabled:opacity-50"
        style={{ background: "var(--primary)", color: "var(--primary-ink)", boxShadow: "0 6px 16px color-mix(in oklab, var(--primary) 35%, transparent)" }}
        onClick={() => {
          setErr("");
          start(async () => {
            try { await settleEvent(event.id, { finalTotal: total, attendedMemberIds: [...attended] }); }
            catch (e) { setErr((e as Error).message); }
          });
        }}
      >
        {pending ? "處理中…" : settled ? "更新結算" : "開始結算"}
      </button>
    </div>
  );
}
