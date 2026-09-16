import type { ImgHTMLAttributes } from "react";

type BaseProps = {
  name?: string | null;
  src?: string | null;
  size?: number;
  ring?: boolean;
} & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">;

function initial(name?: string | null): string {
  if (!name) return "?";
  const trimmed = name.trim();
  return trimmed ? [...trimmed][0]!.toUpperCase() : "?";
}

export function Avatar({ name, src, size = 32, ring = false, className = "", ...rest }: BaseProps) {
  const dim = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  const ringCls = ring ? "ring-2 ring-[var(--surface)] shadow-[0_1px_2px_rgba(0,0,0,.15)]" : "";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name ?? ""}
        style={dim}
        className={`inline-block rounded-full object-cover ${ringCls} ${className}`}
        {...rest}
      />
    );
  }
  return (
    <span
      style={dim}
      className={`inline-flex items-center justify-center rounded-full font-semibold text-[var(--primary-ink)] bg-[var(--primary)] select-none ${ringCls} ${className}`}
      aria-label={name ?? "avatar"}
    >
      {initial(name)}
    </span>
  );
}

export default Avatar;
