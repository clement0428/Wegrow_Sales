"use client";
import { useState, useTransition } from "react";
import { updateSettings } from "@/lib/actions/settings";
import type { SettingsInput } from "@/lib/schemas/settings";

const field = "w-full rounded-2xl border-0 bg-[var(--surface)] px-4 py-3 text-base shadow-sm";
const label = "mb-1 block text-sm font-bold text-[var(--ink-2)]";

export default function SettingsForm({ initial }: { initial: SettingsInput }) {
  const [f, setF] = useState<SettingsInput>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const dirty =
    f.bank_code !== initial.bank_code ||
    f.bank_name !== initial.bank_name ||
    f.bank_account !== initial.bank_account ||
    f.bank_holder !== initial.bank_holder;
  return (
    <div className="space-y-3">
      <div>
        <label className={label}>銀行代碼</label>
        <input className={field} inputMode="numeric" pattern="[0-9]*" placeholder="例：700 郵局、822 中信"
          value={f.bank_code ?? ""} onChange={(e) => setF({ ...f, bank_code: e.target.value })} />
      </div>
      <div>
        <label className={label}>銀行名稱</label>
        <input className={field} placeholder="例：中國信託" value={f.bank_name ?? ""} onChange={(e) => setF({ ...f, bank_name: e.target.value })} />
      </div>
      <div>
        <label className={label}>帳號</label>
        <input className={field} inputMode="numeric" placeholder="數字帳號" value={f.bank_account ?? ""} onChange={(e) => setF({ ...f, bank_account: e.target.value })} />
      </div>
      <div>
        <label className={label}>戶名</label>
        <input className={field} placeholder="請填收款戶名" value={f.bank_holder ?? ""} onChange={(e) => setF({ ...f, bank_holder: e.target.value })} />
      </div>
      {msg && <p className="text-sm text-[var(--ink-3)]">{msg}</p>}
      <button disabled={pending || !dirty}
        onClick={() => { setMsg(""); start(async () => { try { await updateSettings(f); setMsg("已儲存"); } catch (e) { setMsg((e as Error).message); } }); }}
        className="w-full rounded-2xl bg-[var(--primary)] py-3 font-bold text-[var(--primary-ink)] disabled:opacity-50">
        {pending ? "儲存中…" : "儲存"}
      </button>
    </div>
  );
}
