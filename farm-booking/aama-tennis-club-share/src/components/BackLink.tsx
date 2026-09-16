import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function BackLink({ href, label = "返回" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="press w-10 h-10 rounded-[12px] flex items-center justify-center bg-[var(--surface)] border border-[var(--line)] shadow-[var(--shadow-1)] shrink-0"
    >
      <ArrowLeft className="w-5 h-5" strokeWidth={2.4} style={{ color: "var(--ink)" }} />
    </Link>
  );
}
