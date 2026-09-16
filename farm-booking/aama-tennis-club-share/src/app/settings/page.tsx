import BackLink from "@/components/BackLink";
import Image from "next/image";
import SettingsForm from "@/components/SettingsForm";
import { requireMember } from "@/lib/auth/current-member";

export const dynamic = "force-dynamic";

type ThemeOpt = {
  key: "clay" | "hard" | "grass";
  label: string;
  bg: string;  // court fill
  ring: string; // active outline
};
const themes: ThemeOpt[] = [
  { key: "clay",  label: "紅土", bg: "#C55A2B", ring: "#C55A2B" },
  { key: "hard",  label: "硬地", bg: "#2E6BB8", ring: "#2E6BB8" },
  { key: "grass", label: "草地", bg: "#3F8A54", ring: "#3F8A54" },
];

function CourtSwatch({ bg }: { bg: string }) {
  return (
    <div className="w-full aspect-[78/36] rounded-[10px] overflow-hidden relative" style={{ background: bg }}>
      <svg viewBox="0 0 78 36" fill="none" stroke="#fff" strokeLinecap="square" className="absolute inset-1 w-[calc(100%-8px)] h-[calc(100%-8px)]">
        <rect x="0.5" y="0.5" width="77" height="35" strokeWidth="1" />
        <line x1="0.5" y1="4.5" x2="77.5" y2="4.5" strokeWidth=".6" />
        <line x1="0.5" y1="31.5" x2="77.5" y2="31.5" strokeWidth=".6" />
        <line x1="21" y1="4.5" x2="21" y2="31.5" strokeWidth=".6" />
        <line x1="57" y1="4.5" x2="57" y2="31.5" strokeWidth=".6" />
        <line x1="21" y1="18" x2="57" y2="18" strokeWidth=".6" />
        <line x1="39" y1="0" x2="39" y2="36" strokeWidth="1.1" strokeDasharray="1.4 1" />
      </svg>
    </div>
  );
}

export default async function SettingsPage() {
  const me = await requireMember();
  return (
    <div className="space-y-5 p-4 pb-10">
      <BackLink href="/" />

      <div className="rounded-3xl bg-[var(--surface)] p-5 shadow-[var(--shadow-1)]">
        <div className="flex items-center gap-4">
          {me.picture_url ? (
            <Image src={me.picture_url} alt={me.display_name} width={64} height={64} className="rounded-full object-cover" unoptimized />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--primary)] text-white text-xl font-bold">{me.display_name.slice(0,1)}</div>
          )}
          <div>
            <div className="text-xs text-[var(--ink-3)]">LINE 名稱</div>
            <div className="text-xl font-black">{me.display_name}</div>
            <div className="mt-1 text-xs text-[var(--ink-3)]">身分：{me.role === "admin" ? "管理員" : "一般成員"}</div>
          </div>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold text-[var(--ink-2)]">背景風格</h2>
        <div className="grid grid-cols-3 gap-2.5">
          {themes.map((t) => {
            const active = me.theme_preference === t.key;
            return (
              <form key={t.key} action={async (fd: FormData) => { "use server";
                const { updateTheme } = await import("@/lib/actions/settings");
                await updateTheme(String(fd.get("theme")));
              }}>
                <input type="hidden" name="theme" value={t.key} />
                <button
                  className="press flex w-full flex-col items-center gap-1.5 rounded-[14px] border p-2 transition bg-[var(--surface)]"
                  style={active
                    ? { borderColor: t.ring, boxShadow: `0 0 0 2px ${t.ring}` } as React.CSSProperties
                    : { borderColor: "var(--line)" }}
                >
                  <CourtSwatch bg={t.bg} />
                  <div className="text-[13px] font-bold">{t.label}</div>
                </button>
              </form>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--ink-3)]">選擇後即時套用整站配色</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-[var(--ink-2)]">收款帳戶（結算後給其他成員轉錢）</h2>
        <SettingsForm initial={{ bank_code: me.bank_code ?? "", bank_name: me.bank_name ?? "", bank_account: me.bank_account ?? "", bank_holder: me.bank_holder ?? "" }} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-[var(--ink-2)]">帳號</h2>
        <form action={async () => { "use server";
          const { signOut } = await import("@/lib/actions/settings");
          await signOut();
        }}>
          <button className="w-full rounded-2xl border border-red-200 bg-[var(--surface)] py-3 font-bold text-[var(--danger)] hover:bg-red-50">登出</button>
        </form>
      </section>
    </div>
  );
}
