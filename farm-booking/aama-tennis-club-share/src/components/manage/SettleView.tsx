"use client";
import { useTransition } from "react";
import { RotateCcw } from "lucide-react";
import PaymentList from "./PaymentList";
import SettlementSection from "./SettlementSection";
import { reopenSettlement } from "@/lib/actions/settlement";
import type { EventWithCounts, RegistrationWithMember, MemberLite } from "@/lib/db/queries";

type Props = {
  event: EventWithCounts;
  registrations: RegistrationWithMember[];
  candidates: MemberLite[];
};

export default function SettleView({ event, registrations, candidates }: Props) {
  const [pending, start] = useTransition();
  const settled = event.status === "settled";

  if (!settled) {
    return <SettlementSection event={event} registrations={registrations} candidates={candidates} />;
  }

  return (
    <div className="space-y-4">
      <PaymentList event={event} registrations={registrations} />
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm("重新結算會清除目前所有收款紀錄與到場紀錄，確定要繼續嗎？")) return;
          start(async () => {
            try { await reopenSettlement(event.id); }
            catch (e) { alert((e as Error).message); }
          });
        }}
        className="press w-full rounded-[14px] border border-[var(--line)] bg-[var(--surface)] py-3 text-[13.5px] font-bold text-[var(--primary)] flex items-center justify-center gap-1.5 hover:bg-[var(--surface-2)] disabled:opacity-50"
      >
        <RotateCcw className="w-4 h-4" strokeWidth={2.4} />
        {pending ? "處理中…" : "重新結算"}
      </button>
    </div>
  );
}
