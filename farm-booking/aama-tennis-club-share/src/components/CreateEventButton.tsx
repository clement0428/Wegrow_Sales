"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "./BottomSheet";
import EventForm from "./EventForm";
import { createEvent } from "@/lib/actions/events";
import type { Venue } from "@/lib/db/types";

export default function CreateEventButton({ venues }: { venues: Venue[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="開新場次"
        className="press fixed right-6 z-20 lg:absolute lg:right-6"
        style={{
          // sit just above the bottom nav; viewport-fit=cover makes the inset non-zero on iOS
          bottom: "calc(env(safe-area-inset-bottom) + 96px)",
          width: 58,
          height: 58,
          borderRadius: "50%",
          border: "none",
          background: "radial-gradient(circle at 30% 25%, #E4F177 0%, #C6E24A 55%, #A8C837 100%)",
          boxShadow: "0 10px 24px rgba(198,226,74,.5), 0 4px 10px rgba(0,0,0,.15)",
          padding: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <svg width="58" height="58" viewBox="0 0 58 58" fill="none" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          <path d="M6 14 C 18 20, 40 20, 52 14" stroke="rgba(255,255,255,.75)" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M6 44 C 18 38, 40 38, 52 44" stroke="rgba(255,255,255,.75)" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="3" strokeLinecap="round" style={{ position: "relative", zIndex: 1 }}>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="開新場次">
        <EventForm venues={venues} submitLabel="建立場次" onSubmit={async (input) => { const { id } = await createEvent(input); setOpen(false); router.push(`/?event=${id}`, { scroll: false }); }} />
      </BottomSheet>
    </>
  );
}
