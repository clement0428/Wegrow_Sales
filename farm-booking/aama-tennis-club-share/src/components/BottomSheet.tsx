"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export default function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;
  const target = document.getElementById("phone-portal");
  if (!target) return null;

  return createPortal(
    <div className="absolute inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 animate-rise" />
      <div
        className="animate-sheet-up absolute inset-x-0 bottom-0 top-[10%] overflow-hidden rounded-t-[26px] bg-[var(--bg)]"
        style={{ boxShadow: "0 -12px 30px rgba(0,0,0,.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-2 left-0 right-0 z-10 flex justify-center pointer-events-none">
          <div className="w-10 h-1 rounded-full bg-[color-mix(in_oklab,var(--ink)_15%,transparent)]" />
        </div>
        {/* Whole sheet scrolls (title included) so a drag anywhere on it scrolls */}
        <div
          className="h-full overflow-y-auto no-scrollbar px-5 pt-6"
          style={{
            overscrollBehavior: "contain",
            touchAction: "pan-y",
            WebkitOverflowScrolling: "touch",
            paddingBottom: "calc(env(safe-area-inset-bottom) + 20px)",
          }}
        >
          <h2 className="font-display text-[24px] font-extrabold mb-2">{title}</h2>
          {children}
        </div>
      </div>
    </div>,
    target,
  );
}
