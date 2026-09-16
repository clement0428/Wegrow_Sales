"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelEvent } from "@/lib/actions/events";

export default function CancelEventButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition(); const router = useRouter();
  return (
    <button disabled={pending} className="w-full rounded-2xl border border-red-200 bg-white py-3 font-bold text-red-600"
      onClick={() => { if (confirm("確定取消這個場次？取消後不計統計。")) start(async () => { await cancelEvent(eventId); router.push("/manage"); }); }}>
      取消場次
    </button>
  );
}
