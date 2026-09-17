"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type State = "init" | "verifying" | "error";

export default function LiffLogin({ liffId, devLogin, returnTo = "/" }: { liffId: string | null; devLogin: boolean; returnTo?: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>("init");
  const [msg, setMsg] = useState("");

  // Mirrors the real init/login state for external observability (postdeploy
  // verification) — set only from the actual flow's own transitions below,
  // never from a second/parallel init call.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __LIFF_INIT_STATE__?: string }).__LIFF_INIT_STATE__ = state;
    }
  }, [state]);

  useEffect(() => {
    if (!liffId) return;
    let cancelled = false;
    (async () => {
      const liff = (await import("@line/liff")).default;
      try {
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) { liff.login({ redirectUri: window.location.href }); return; }
        const idToken = liff.getIDToken();
        if (!idToken) { liff.logout(); liff.login({ redirectUri: window.location.href }); return; }
        setState("verifying");
        const res = await fetch("/api/auth/line", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) });
        if (!res.ok) {
          const j = await res.json().catch(() => ({})) as { error?: string };
          if (String(j.error ?? "").toLowerCase().includes("expired")) { liff.logout(); liff.login({ redirectUri: window.location.href }); return; }
          throw new Error(j.error ?? "登入失敗");
        }
        if (!cancelled) router.replace(returnTo);
      } catch (e) {
        if (!cancelled) { setState("error"); setMsg((e as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, [liffId, router, returnTo]);

  return (
    <div className="flex flex-1 min-h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Image src="/brand/aama-tennis-club-logo.jpeg" alt="AAMA 網球社" width={120} height={120} className="rounded-3xl shadow-lg" priority />
      <div>
        <h1 className="text-3xl font-black">AAMA 網球社</h1>
        <p className="mt-1 text-sm tracking-wider text-gray-500">預約系統</p>
      </div>
      {liffId ? (
        <p className="text-gray-600">{state === "error" ? `登入失敗：${msg}` : "正在用 LINE 登入…"}</p>
      ) : (
        <p className="text-gray-600">尚未設定 LIFF ID</p>
      )}
      {devLogin && (
        <div className="mt-6 flex flex-col gap-2 rounded-2xl border border-dashed p-4">
          <p className="text-xs text-gray-500">開發模式假登入</p>
          <a className="rounded-xl bg-blue-600 px-4 py-2 text-white" href="/api/auth/dev-login?name=測試成員">以測試成員登入</a>
          <a className="rounded-xl bg-gray-800 px-4 py-2 text-white" href="/api/auth/dev-login?name=測試管理員&admin=1">以測試管理員登入</a>
        </div>
      )}
    </div>
  );
}
