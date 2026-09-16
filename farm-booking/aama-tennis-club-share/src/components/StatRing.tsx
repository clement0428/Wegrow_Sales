"use client";
import { useEffect, useState } from "react";

type Props = { percent: number; size?: number; stroke?: number; label?: string };

export default function StatRing({ percent, size = 124, stroke = 10, label = "出席率" }: Props) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const target = Math.max(0, Math.min(100, percent));
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    // Small delay so 0 → target animation is visible
    const id = window.setTimeout(() => setDrawn(target), 50);
    return () => window.clearTimeout(id);
  }, [target]);
  const offset = c * (1 - drawn / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} stroke="var(--surface-2)" strokeWidth={stroke} fill="none" />
        <circle
          cx="50" cy="50" r={r}
          stroke="var(--primary)" strokeWidth={stroke} fill="none"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(.2,.7,.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-display tabular text-[32px] font-extrabold leading-none">
          {Math.round(drawn)}<span className="text-[15px] font-semibold">%</span>
        </div>
        <div className="text-[10px] text-[var(--ink-3)] tracking-[.08em] mt-0.5">{label}</div>
      </div>
    </div>
  );
}
