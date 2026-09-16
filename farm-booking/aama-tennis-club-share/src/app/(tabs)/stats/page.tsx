import { requireMember } from "@/lib/auth/current-member";
import { listAttendanceRows, listEvents, listMembers, sumPaid, listMyRegistrations } from "@/lib/db/queries";
import { computeAttendance, buildLeaderboard } from "@/lib/domain/stats";
import { isPast } from "@/lib/domain/event-status";
import Leaderboard from "@/components/Leaderboard";
import StatRing from "@/components/StatRing";

export const dynamic = "force-dynamic";

export default async function StatsPage() {
  const me = await requireMember();
  const now = new Date();
  const [rows, events, members, paid, myRegs] = await Promise.all([
    listAttendanceRows(), listEvents(), listMembers(), sumPaid(), listMyRegistrations(me.id)
  ]);
  const counts = computeAttendance(rows, now);
  const lb = buildLeaderboard(counts, members);
  const totalPastEvents = events.filter((e) => isPast(e, now)).length;
  const myAttended = counts.get(me.id) ?? 0;
  const attendPct = totalPastEvents === 0 ? 0 : (myAttended / totalPastEvents) * 100;

  const mySettled = myRegs.filter((r) => r.event.status === "settled" && r.attended === 1);
  const myPaid = mySettled.filter((r) => r.paid_at).reduce((s, r) => s + (r.paid_amount ?? 0), 0);
  const myOwed = mySettled.filter((r) => !r.paid_at).reduce((s, r) => s + (r.amount_due ?? 0), 0);

  return (
    <div className="px-2">
      <div className="pt-1 pb-2">
        <div className="text-[11px] font-bold tracking-[.16em] uppercase text-[var(--primary)]">總累積</div>
      </div>

      {/* Big ring */}
      <div className="bg-[var(--surface)] rounded-[22px] p-[18px] shadow-[var(--shadow-1)] flex items-center gap-4 mt-1">
        <StatRing percent={attendPct} />
        <div className="flex-1 grid grid-cols-2 gap-x-1.5 gap-y-3">
          <div>
            <div className="font-display tabular text-[22px] font-extrabold leading-none">{myAttended}</div>
            <div className="text-[11px] text-[var(--ink-2)] mt-0.5">我出席場次</div>
          </div>
          <div>
            <div className="font-display tabular text-[22px] font-extrabold leading-none">{totalPastEvents}</div>
            <div className="text-[11px] text-[var(--ink-2)] mt-0.5">社團總場</div>
          </div>
          <div>
            <div className="font-display tabular text-[18px] font-extrabold leading-none">${myPaid}</div>
            <div className="text-[11px] text-[var(--ink-2)] mt-0.5">已付金額</div>
          </div>
          <div>
            <div className="font-display tabular text-[18px] font-extrabold leading-none" style={{ color: myOwed > 0 ? "var(--primary)" : "var(--ink)" }}>${myOwed}</div>
            <div className="text-[11px] text-[var(--ink-2)] mt-0.5">我待付</div>
          </div>
        </div>
      </div>

      {/* Team-wide totals row */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="bg-[var(--surface)] rounded-[14px] p-3 shadow-[var(--shadow-1)]">
          <div className="text-[10.5px] text-[var(--ink-3)] tracking-[.08em]">總出席人次</div>
          <div className="font-display tabular text-[20px] font-extrabold mt-1">{[...counts.values()].reduce((a, b) => a + b, 0)}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-[14px] p-3 shadow-[var(--shadow-1)]">
          <div className="text-[10.5px] text-[var(--ink-3)] tracking-[.08em]">已收款總額</div>
          <div className="font-display tabular text-[20px] font-extrabold mt-1">${paid}</div>
        </div>
        <div className="bg-[var(--surface)] rounded-[14px] p-3 shadow-[var(--shadow-1)]">
          <div className="text-[10.5px] text-[var(--ink-3)] tracking-[.08em]">會員數</div>
          <div className="font-display tabular text-[20px] font-extrabold mt-1">{members.length}</div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="mt-4">
        {lb.length === 0 ? (
          <p className="py-6 text-center text-[var(--ink-3)] text-sm">還沒有出席紀錄</p>
        ) : (
          <Leaderboard entries={lb} currentUserId={me.id} />
        )}
      </div>
    </div>
  );
}
