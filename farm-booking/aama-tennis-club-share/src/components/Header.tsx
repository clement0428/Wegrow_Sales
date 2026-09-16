import Link from "next/link";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import Avatar from "./Avatar";
import type { Member } from "@/lib/db/types";

export default function Header({ member }: { member: Member }) {
  return (
    <header
      className="sticky top-0 z-30 backdrop-blur-md"
      style={{
        background: "color-mix(in oklab, var(--bg) 82%, transparent)",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div className="mx-auto max-w-[520px] px-4 h-14 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          <span aria-hidden className="relative inline-flex items-center justify-center w-8 h-8 rounded-[10px] overflow-hidden shrink-0">
            <Image src="/brand/aama-tennis-club-logo.jpeg" alt="" width={64} height={64} className="w-full h-full object-cover" priority />
          </span>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-none text-[var(--ink)] truncate">AAMA 網球社</div>
            <div className="text-[10.5px] mt-0.5 font-medium tracking-[0.14em] uppercase text-[var(--ink-3)]">AAMA · TENNIS</div>
          </div>
        </Link>
        <Link
          href="/settings"
          aria-label="設定"
          className="press ml-auto flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 bg-[var(--surface)] border border-[var(--line)] hover:bg-[var(--surface-2)]"
        >
          <Avatar name={member.display_name} src={member.picture_url} size={26} ring />
          <span className="text-[12.5px] font-semibold text-[var(--ink)] max-w-[80px] truncate">{member.display_name}</span>
          <ChevronDown className="w-3.5 h-3.5 text-[var(--ink-3)]" strokeWidth={2.5} />
        </Link>
      </div>
    </header>
  );
}
