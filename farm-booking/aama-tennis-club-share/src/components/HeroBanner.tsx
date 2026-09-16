import type { CSSProperties, ReactNode } from "react";

// Shared gradient banner (radius / padding / shadow / court watermark) so every page's hero has the same size and look.
export default function HeroBanner({
  children,
  className = "",
  style,
  watermark = true,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  watermark?: boolean;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[22px] p-[18px] min-h-[140px] text-white ${className}`}
      style={{
        background: "linear-gradient(135deg,var(--primary) 0%,color-mix(in oklab,var(--primary) 75%,#FFC08A) 100%)",
        boxShadow: "0 8px 20px color-mix(in oklab, var(--primary) 30%, transparent)",
        ...style,
      }}
    >
      {watermark && (
        <svg
          aria-hidden
          className="absolute -right-[60px] -top-[10px] -bottom-[10px] opacity-[.32] h-[calc(100%+20px)] w-auto pointer-events-none"
          viewBox="0 0 39 36" fill="none" stroke="#fff" strokeLinecap="square"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect x="0.5" y="0.5" width="38" height="35" strokeWidth=".55" />
          <line x1="0.5" y1="4.5" x2="38.5" y2="4.5" strokeWidth=".4" />
          <line x1="0.5" y1="31.5" x2="38.5" y2="31.5" strokeWidth=".4" />
          <line x1="21" y1="4.5" x2="21" y2="31.5" strokeWidth=".4" />
          <line x1="0.5" y1="18" x2="21" y2="18" strokeWidth=".4" />
          <line x1="37.5" y1="17.2" x2="38.5" y2="18.8" strokeWidth=".55" />
          <line x1="0.5" y1="0" x2="0.5" y2="36" strokeWidth=".7" strokeDasharray=".8 .5" />
        </svg>
      )}
      <div className="relative">{children}</div>
    </div>
  );
}
