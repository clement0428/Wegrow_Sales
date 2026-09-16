"use client";
import { useTransition, useState } from "react";
import { Check, Plus, LogOut } from "lucide-react";
import { register, cancel } from "@/lib/actions/registrations";
import type { DisplayStatus } from "@/lib/domain/event-status";

type Props = {
  eventId: string;
  mine: "confirmed" | "waitlisted" | null;
  status: DisplayStatus;
  full: boolean;
};

export default function RegisterButton({ eventId, mine, status, full }: Props) {
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const [pulse, setPulse] = useState(false);

  const eventOpen = status === "接龍中" || status === "已截止";
  if (!eventOpen) {
    return (
      <button disabled className="w-full h-12 rounded-full font-semibold text-[15px] bg-[var(--surface-2)] text-[var(--ink-3)]">
        {status}
      </button>
    );
  }
  const joined = !!mine;
  const deadlinePassed = status === "已截止";
  const isWaitlist = !joined && full;
  const canJoin = !joined;
  const canCancel = joined && !deadlinePassed;
  const btnEnabled = canJoin || canCancel;
  const label = joined
    ? (deadlinePassed ? "已截止 · 無法退出"
       : mine === "confirmed" ? "取消接龍" : "取消候補")
    : isWaitlist
      ? "加入候補 +1"
      : "接龍 +1";

  const handle = () => {
    setErr("");
    setPulse(true);
    setTimeout(() => setPulse(false), 600);
    start(async () => {
      try {
        if (joined) await cancel(eventId);
        else await register(eventId);
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={handle}
        disabled={pending || !btnEnabled}
        className="press relative w-full h-12 rounded-full font-semibold text-[15px] flex items-center justify-center gap-2 overflow-hidden disabled:opacity-70"
        style={
          joined
            ? { background: "var(--surface-2)", color: "var(--ink)" }
            : isWaitlist
            ? { background: "var(--accent)", color: "var(--accent-ink)" }
            : { background: "var(--primary)", color: "var(--primary-ink)", boxShadow: "0 6px 16px color-mix(in oklab, var(--primary) 35%, transparent)" }
        }
      >
        {pulse && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{
              animation: "rise .6s ease-out",
              background: "radial-gradient(circle at 50% 50%, color-mix(in oklab, var(--accent) 55%, transparent) 0%, transparent 60%)",
            }}
          />
        )}
        {joined ? <LogOut className="w-4 h-4" /> : <Plus className="w-4 h-4" strokeWidth={3} />}
        <span>{pending ? "處理中…" : label}</span>
        {joined && <Check className="w-4 h-4 opacity-60" />}
      </button>
      {err && <p className="mt-2 text-center text-sm text-[var(--danger)]">{err}</p>}
    </div>
  );
}
