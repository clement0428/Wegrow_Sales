"use client";
import { useState, useTransition } from "react";
import { UserPlus2, Plus, X } from "lucide-react";
import Avatar from "@/components/Avatar";
import { organizerRemove, addAttendeeToEvent } from "@/lib/actions/registrations";
import type { RegistrationWithMember, MemberLite } from "@/lib/db/queries";

type Props = {
  eventId: string;
  registrations: RegistrationWithMember[];
  candidates: MemberLite[];
  locked?: boolean;
};

function Row({ r, locked, pending, onRemove }: { r: RegistrationWithMember; locked: boolean; pending: boolean; onRemove: () => void; }) {
  return (
    <div className="flex items-center gap-3 py-2.5">
      <Avatar name={r.member.display_name} src={r.member.picture_url} size={32} />
      <span className="text-[14px] font-semibold flex-1">{r.member.display_name}</span>
      {!locked && (
        <button
          type="button"
          disabled={pending}
          onClick={onRemove}
          aria-label="移除"
          className="press w-6 h-6 rounded-full flex items-center justify-center hover:bg-[var(--surface-2)] shrink-0"
        >
          <X className="w-4 h-4 text-[var(--ink-3)]" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

export default function RosterManager({ eventId, registrations, candidates, locked = false }: Props) {
  const [q, setQ] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const confirmed = registrations.filter((r) => r.status === "confirmed").sort((a, b) => a.seat_no - b.seat_no);
  const waitlisted = registrations.filter((r) => r.status === "waitlisted").sort((a, b) => a.seat_no - b.seat_no);

  const suggestion = q.trim().length > 0
    ? candidates.filter((m) => m.display_name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 5)
    : [];
  const noMatch = q.trim().length > 0 && suggestion.length === 0;

  const run = (fn: () => Promise<void>) => start(async () => { try { await fn(); } catch (e) { setErr((e as Error).message); } });

  return (
    <div className="rounded-[18px] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
      <h3 className="text-[15px] font-bold mb-3">名單</h3>

      {/* Confirmed */}
      <div>
        <div className="flex items-baseline justify-between">
          <div className="text-[10.5px] font-bold uppercase tracking-[.12em] text-[var(--primary)]">正取</div>
          <div className="text-[10.5px] tabular text-[var(--ink-3)]">{confirmed.length} 人</div>
        </div>
        <div className="mt-1 divide-y divide-[var(--line)]">
          {confirmed.map((r) => (
            <Row key={r.id} r={r} locked={locked} pending={pending}
              onRemove={() => run(() => organizerRemove(eventId, r.member_id))} />
          ))}
          {confirmed.length === 0 && <p className="py-3 text-center text-[12.5px] text-[var(--ink-3)]">還沒有正取</p>}
        </div>
      </div>

      {/* Waitlisted */}
      {waitlisted.length > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between">
            <div className="text-[10.5px] font-bold uppercase tracking-[.12em] text-[var(--ink-3)]">候補</div>
            <div className="text-[10.5px] tabular text-[var(--ink-3)]">{waitlisted.length} 人</div>
          </div>
          <div className="mt-1 divide-y divide-[var(--line)]">
            {waitlisted.map((r) => (
              <Row key={r.id} r={r} locked={locked} pending={pending}
                onRemove={() => run(() => organizerRemove(eventId, r.member_id))} />
            ))}
          </div>
        </div>
      )}

      {!locked && (
        <>
          {showAdd ? (
            <div className="mt-4 relative">
              <div className="flex items-center gap-2 rounded-[12px] bg-[var(--surface-2)] px-3 py-2.5">
                <UserPlus2 className="w-4 h-4 text-[var(--ink-3)]" />
                <input
                  autoFocus
                  type="text"
                  placeholder="搜尋成員或輸入名稱新增"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="flex-1 bg-transparent border-0 outline-none text-[13.5px]"
                />
                <button type="button" onClick={() => { setShowAdd(false); setQ(""); }}
                  className="press text-[12px] font-semibold text-[var(--ink-3)]">取消</button>
              </div>
              {(suggestion.length > 0 || noMatch) && (
                <div className="mt-1.5 rounded-[12px] bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-2)] overflow-hidden">
                  {suggestion.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      disabled={pending}
                      onClick={() => run(async () => { await addAttendeeToEvent(eventId, { memberId: m.id }); setQ(""); })}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--surface-2)] border-b border-[var(--line)] last:border-0"
                    >
                      <Avatar name={m.display_name} src={m.picture_url} size={26} />
                      <span className="text-[13.5px] font-semibold flex-1">{m.display_name}</span>
                      <Plus className="w-3.5 h-3.5 text-[var(--ink-3)]" />
                    </button>
                  ))}
                  {noMatch && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(async () => { await addAttendeeToEvent(eventId, { guestName: q.trim() }); setQ(""); })}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--surface-2)] text-[var(--primary)]"
                    >
                      <UserPlus2 className="w-3.5 h-3.5" />
                      <span className="text-[13.5px] font-semibold">新增「{q.trim()}」為客串</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="press mt-4 w-full rounded-[12px] border border-dashed border-[var(--line)] py-2.5 text-[13.5px] font-semibold text-[var(--primary)] flex items-center justify-center gap-1.5 hover:bg-[var(--surface-2)]"
            >
              <Plus className="w-4 h-4" strokeWidth={2.5} />新增名單
            </button>
          )}
        </>
      )}
      {err && <p className="mt-2 text-[12.5px] text-center text-[var(--danger)]">{err}</p>}
    </div>
  );
}
