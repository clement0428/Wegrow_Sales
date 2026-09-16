"use client";
import EventForm from "@/components/EventForm";
import { updateEvent } from "@/lib/actions/events";
import type { EventInput } from "@/lib/schemas/event";
import type { Venue } from "@/lib/db/types";
import { useState } from "react";

export default function EditEventSection({ eventId, venues, initial }: { eventId: string; venues: Venue[]; initial: EventInput }) {
  const [savedMsg, setSavedMsg] = useState("");
  return (
    <div className="rounded-[18px] bg-[var(--surface)] p-4 shadow-[var(--shadow-1)]">
      <h3 className="text-[15px] font-bold mb-3">場次資訊</h3>
      <EventForm
        venues={venues}
        initial={initial}
        submitLabel="更新場次"
        onSubmit={async (i) => { await updateEvent(eventId, i); setSavedMsg("已更新"); setTimeout(() => setSavedMsg(""), 1500); }}
      />
      {savedMsg && <p className="mt-2 text-[12.5px] text-center text-[var(--success)] font-semibold">{savedMsg}</p>}
    </div>
  );
}
