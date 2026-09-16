"use client";
import Avatar from "./Avatar";
import { Trophy } from "lucide-react";
import type { LeaderboardEntry } from "@/lib/domain/stats";

const MEDALS = ["#F2C94C", "#C0C0C7", "#CD8B5A"];

export default function Leaderboard({ entries, currentUserId }: { entries: LeaderboardEntry[]; currentUserId?: string }) {
  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const maxCount = Math.max(1, ...entries.map(e => e.count));
  const order = [1, 0, 2]; // podium order: 2nd, 1st, 3rd

  return (
    <div className="rounded-[var(--radius-lg)] bg-[var(--surface)] shadow-[var(--shadow-1)] overflow-hidden">
      <div
        className="relative pt-6 pb-4 px-4"
        style={{ background: "linear-gradient(180deg, var(--court-soft) 0%, transparent 100%)" }}
      >
        <div className="flex items-center justify-center gap-1.5 mb-4">
          <Trophy className="w-4 h-4" style={{ color: "var(--primary)" }} />
          <div className="text-[12px] font-semibold tracking-[.16em] text-[var(--primary)]">
            出席排行榜
          </div>
        </div>
        <div className="flex items-end justify-center gap-3 min-h-[130px]">
          {order.map((idx) => {
            const e = top3[idx];
            if (!e) return <div key={idx} className="w-[80px]" />;
            const heights = [96, 72, 56];
            const h = heights[idx];
            const isMe = currentUserId === e.member.id;
            const delayMs = (2 - idx) * 250;
            return (
              <div
                key={e.member.id}
                className="w-[80px] flex flex-col items-center animate-podium-in"
                style={{ animationDelay: `${delayMs}ms` }}
              >
                <div className="relative mb-1.5">
                  <Avatar name={e.member.display_name} src={e.member.picture_url} size={idx === 0 ? 52 : 44} ring />
                  <span
                    className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shadow"
                    style={{ background: MEDALS[idx] }}
                  >
                    {idx + 1}
                  </span>
                </div>
                <div className={`text-[12.5px] font-semibold truncate max-w-full ${isMe ? "text-[var(--primary)]" : "text-[var(--ink)]"}`}>
                  {e.member.display_name}
                </div>
                <div className="text-[10.5px] text-[var(--ink-3)] tabular">{e.count} 場</div>
                <div
                  className="mt-1.5 w-full rounded-t-lg flex items-start justify-center pt-1.5 text-[10px] font-bold text-white/90"
                  style={{
                    height: h,
                    background: idx === 0
                      ? "var(--primary)"
                      : idx === 1
                        ? "color-mix(in oklab, var(--primary) 65%, var(--surface-2))"
                        : "color-mix(in oklab, var(--primary) 45%, var(--surface-2))",
                  }}
                >
                  {["🥇", "🥈", "🥉"][idx]}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {rest.length > 0 && (
        <ol className="divide-y divide-[var(--line)]">
          {rest.map((e, i) => {
            const rank = i + 4;
            const isMe = currentUserId === e.member.id;
            const pct = (e.count / maxCount) * 100;
            return (
              <li
                key={e.member.id}
                className="flex items-center gap-3 px-4 py-3"
                style={isMe ? { background: "var(--primary-soft)" } : undefined}
              >
                <span className="w-6 text-center text-[13px] font-bold tabular text-[var(--ink-3)]">
                  {rank}
                </span>
                <Avatar name={e.member.display_name} src={e.member.picture_url} size={30} />
                <div className="min-w-0 flex-1">
                  <div className={`text-[13.5px] font-semibold truncate ${isMe ? "text-[var(--primary)]" : "text-[var(--ink)]"}`}>
                    {e.member.display_name}
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-[var(--surface-2)] overflow-hidden">
                    <div className="h-full cap-fill" style={{ width: `${pct}%`, background: "var(--court)" }} />
                  </div>
                </div>
                <div className="text-[13px] font-bold tabular text-[var(--ink)]">
                  {e.count}<span className="text-[10px] font-medium text-[var(--ink-3)]"> 場</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
