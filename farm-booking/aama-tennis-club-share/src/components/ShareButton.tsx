"use client";
import { Share2 } from "lucide-react";
import { useState } from "react";

export default function ShareButton({ title, text, path }: { title: string; text: string; path: string }) {
  const [msg, setMsg] = useState("");
  const share = async () => {
    const url = `${window.location.origin}${path}`;
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    try {
      if (liffId) {
        const liff = (await import("@line/liff")).default;
        if (!liff.id) await liff.init({ liffId });
        if (liff.isInClient() && liff.isApiAvailable("shareTargetPicker")) {
          const liffUrl = `https://liff.line.me/${liffId}${path}`;
          await liff.shareTargetPicker([{ type: "text", text: `${title}\n${text}\n${liffUrl}` }]);
          return;
        }
      }
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
      await navigator.clipboard.writeText(url); setMsg("已複製連結");
    } catch { setMsg("分享取消或失敗"); }
  };
  return (
    <button onClick={share} className="flex items-center gap-1 rounded-full border bg-white px-3 py-1.5 text-sm font-semibold"><Share2 size={16} />分享{msg && <span className="text-xs text-gray-400">（{msg}）</span>}</button>
  );
}
