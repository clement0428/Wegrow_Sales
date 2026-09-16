"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CalendarDays, User, BarChart3, Wrench } from "lucide-react";

type Item = {
  href: string;
  label: string;
  Icon: typeof CalendarDays;
  match: (p: string) => boolean;
};

const ITEMS: Item[] = [
  { href: "/",       label: "場次", Icon: CalendarDays, match: p => p === "/" },
  { href: "/me",     label: "我的", Icon: User,         match: p => p.startsWith("/me") },
  { href: "/stats",  label: "統計", Icon: BarChart3,    match: p => p.startsWith("/stats") },
  { href: "/manage", label: "管理", Icon: Wrench,       match: p => p.startsWith("/manage") },
];

export default function BottomNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Highlight the tapped tab immediately instead of waiting for the server round trip
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => { setPendingHref(null); }, [pathname]);
  const activePath = pendingHref ?? pathname;

  return (
    <nav
      className="bottom-nav-wrap fixed left-0 right-0 z-30 pointer-events-none lg:sticky lg:left-auto lg:right-auto"
      style={{
        bottom: 0,
        paddingBottom: "env(safe-area-inset-bottom)",
        background: "linear-gradient(to bottom, transparent 0%, var(--bg) 60%)",
      }}
    >
      <div className="mx-auto max-w-[520px] px-3 pb-2 pt-3">
        <div
          className="pointer-events-auto relative flex items-stretch justify-between rounded-full px-1.5 py-1.5"
          style={{
            background: "color-mix(in oklab, var(--surface) 92%, transparent)",
            backdropFilter: "blur(14px)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow-2)",
          }}
        >
          {ITEMS.map(({ href, label, Icon, match }) => {
            const active = match(activePath);
            return (
              <Link
                key={href}
                href={href}
                prefetch
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  e.preventDefault();
                  if (match(pathname)) return;
                  setPendingHref(href);
                  startTransition(() => router.push(href));
                }}
                className="press relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 rounded-full transition-colors"
                style={
                  active
                    ? { background: "var(--primary)", color: "var(--primary-ink)" }
                    : { color: "var(--ink-2)" }
                }
              >
                <Icon className="w-[18px] h-[18px]" strokeWidth={active ? 2.4 : 2} />
                <span
                  className="text-[10.5px] font-semibold leading-none"
                  style={{ letterSpacing: active ? ".02em" : 0 }}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
