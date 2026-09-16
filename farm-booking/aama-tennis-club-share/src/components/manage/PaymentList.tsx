"use client";
import { useTransition } from "react";
import { Check } from "lucide-react";
import Avatar from "@/components/Avatar";
import { markPaid, unmarkPaid } from "@/lib/actions/settlement";
import type { EventWithCounts, RegistrationWithMember } from "@/lib/db/queries";

export default function PaymentList({ event, registrations }: { event: EventWithCounts; registrations: RegistrationWithMember[] }) {
  const [pending, start] = useTransition();
  const rows = registrations.filter((r) => r.attended === 1);
  const perPerson = rows[0]?.amount_due ?? 0;
  const attendedCount = rows.length;
  const total = event.final_total ?? attendedCount * perPerson;

  return (
    <>
      {/* Summary card: 3 columns */}
      <div className="rounded-[18px] bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
        <div className="grid grid-cols-3 items-center text-center divide-x divide-[var(--line)]">
          <div className="px-2">
            <div className="text-[11px] font-semibold text-[var(--ink-3)] tracking-[.08em]">出席</div>
            <div className="font-display tabular text-[26px] font-extrabold mt-1">{attendedCount}<span className="text-[13px] font-semibold ml-1">人</span></div>
          </div>
          <div className="px-2">
            <div className="text-[11px] font-semibold text-[var(--ink-3)] tracking-[.08em]">總額</div>
            <div className="font-display tabular text-[26px] font-extrabold mt-1">${total}</div>
          </div>
          <div className="px-2">
            <div className="text-[11px] font-semibold text-[var(--ink-3)] tracking-[.08em]">均分</div>
            <div className="font-display tabular text-[26px] font-extrabold mt-1" style={{ color: "var(--primary)" }}>${perPerson}</div>
          </div>
        </div>
      </div>

      {/* Payment list */}
      <div className="mt-5">
        <h3 className="text-[14px] font-bold text-[var(--ink-2)] mb-2.5">收款狀態</h3>
        <div className="space-y-2.5">
          {rows.map((r) => {
            const paid = !!r.paid_at;
            const mismatch = paid && r.paid_amount !== r.amount_due;
            return (
              <button
                type="button"
                disabled={pending}
                key={r.id}
                onClick={() => start(() => (paid ? unmarkPaid(event.id, r.member_id) : markPaid(event.id, r.member_id)))}
                className="press w-full flex items-center gap-3 rounded-[14px] bg-[var(--surface)] px-3.5 py-3 shadow-[var(--shadow-1)]"
              >
                <Avatar name={r.member.display_name} src={r.member.picture_url} size={36} />
                <div className="flex-1 text-left min-w-0">
                  <div className="text-[15px] font-semibold text-[var(--ink)] truncate">{r.member.display_name}</div>
                  {mismatch && <div className="text-[11px] font-bold text-[var(--danger)]">已付金額與應付不符</div>}
                </div>
                <div className="font-display tabular text-[16px] font-bold text-[var(--ink)]">${r.amount_due}</div>
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center border-2 ${paid ? "border-[var(--primary)] bg-[var(--primary)] text-white" : "border-[var(--line)]"}`}
                >
                  {paid && <Check className="w-4 h-4" strokeWidth={3.5} />}
                </div>
              </button>
            );
          })}
          {rows.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--ink-3)]">還沒有到場人員</p>
          )}
        </div>
      </div>
    </>
  );
}
