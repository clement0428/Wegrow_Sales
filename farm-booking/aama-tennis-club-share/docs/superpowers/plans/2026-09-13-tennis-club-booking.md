# 網球社預約系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一個 LINE 登入的網球社開場／接龍／結算／統計網站，部署到 Cloudflare Workers。

**Architecture:** Next.js 16 App Router，前端用 LIFF 取得 id_token，伺服器向 LINE 驗證後發自簽 cookie。所有資料存取在伺服器端以 Supabase secret key 進行，前端不直連資料庫。報名、取消、遞補、結算等需要原子性的操作寫成 Postgres function。純計算（狀態推導、分帳、統計）放在 `src/lib/domain` 以單元測試覆蓋。

**Tech Stack:** Next.js 16.3、React 19、TypeScript、Tailwind CSS 4、@line/liff 2.31、@supabase/supabase-js 2.116、jose 6、zod 4、vitest 5、@opennextjs/cloudflare 1.20、wrangler 4。

**Spec:** `docs/superpowers/specs/2026-09-13-tennis-club-booking-design.md`

## Global Constraints

- 時間一律以 Asia/Taipei 解讀與顯示；資料庫存 timestamptz。台灣無日光節約時間，組合 `YYYY-MM-DDTHH:mm:00+08:00` 即可。
- 全表開啟 RLS，不對 anon / authenticated 設任何 policy；資料存取只用伺服器端 secret key。
- 每個 Server Action 先取登入成員再檢查授權，輸入用 zod 驗證。
- 每人應付 = ceil(final_total ÷ 到場人數)；未到場者 0；到場人數 0 不可結算。
- 名額上限預設 8；結束報名時間預設活動前一天的開始時間。
- 不使用 `export const runtime = "edge"`（OpenNext 不支援）。
- 機密（SUPABASE_SECRET_KEY、SESSION_SECRET）不進 repo；本機放 `.env.local` 與 `.dev.vars`，正式用 `wrangler secret`。
- Next.js 16：`cookies()` 與 `headers()` 是非同步，必須 `await`。
- 溝通與文案用繁體中文，術語寫「中文（完整英文）」，不用縮寫。
- 每完成一個 Task 就 commit；commit 訊息結尾加 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

## File Structure

```
src/
  app/
    layout.tsx                 根 layout：字型、背景、html lang
    login/page.tsx             LIFF 登入頁（client）
    (tabs)/layout.tsx          需登入；頂部列 + 底部四分頁
    (tabs)/page.tsx            場次列表
    (tabs)/me/page.tsx         我的
    (tabs)/stats/page.tsx      統計
    (tabs)/manage/page.tsx     管理列表
    (tabs)/manage/[id]/page.tsx 單場管理（編輯、名單、結算、收款、取消）
    (tabs)/manage/venues/page.tsx 場地維護（admin）
    events/[id]/page.tsx       場次詳情（需登入）
    api/auth/line/route.ts     LINE id_token 驗證 → cookie
    api/auth/dev-login/route.ts 開發假登入
    api/auth/logout/route.ts
  components/
    AppShell.tsx BottomNav.tsx Header.tsx
    EventCard.tsx CapacityBar.tsx StatusBadge.tsx Avatar.tsx
    EventForm.tsx              開場／編輯表單（client）
    RegisterButton.tsx ShareButton.tsx
    SettlementForm.tsx PaymentList.tsx
    LiffLogin.tsx              client：liff.init → 送 id_token
  lib/
    env.ts                     讀取環境變數
    time.ts                    Asia/Taipei 工具
    auth/session.ts            簽發／驗證 cookie
    auth/current-member.ts     getCurrentMember()、requireMember()、requireAdmin()
    auth/line.ts               verifyLineIdToken()
    db/admin.ts                Supabase admin client
    db/types.ts                資料列型別
    db/queries.ts              讀取查詢
    domain/event-status.ts     deriveEventStatus()
    domain/settlement.ts       computeSettlement()
    domain/stats.ts            computeAttendance()、buildLeaderboard()
    actions/events.ts          createEvent、updateEvent、cancelEvent
    actions/registrations.ts   register、cancel、organizerAdd、organizerRemove
    actions/settlement.ts      settleEvent、markPaid、unmarkPaid
    actions/venues.ts          createVenue、updateVenue
supabase/
  migrations/0001_schema.sql
  migrations/0002_functions.sql
tests/
  domain/*.test.ts  auth/session.test.ts  auth/line.test.ts
  db/registration-functions.test.ts（需 dev 專案環境變數，否則跳過）
```

---

### Task 1: 專案骨架與測試工具

**Files:**
- Create: 整個 Next.js 專案（create-next-app）、`vitest.config.ts`、`tests/smoke.test.ts`、`.env.example`
- Modify: `.gitignore`（已存在，補 `.open-next/`、`.dev.vars`、`.wrangler/`）

**Interfaces:**
- Produces: `npm test` 跑 vitest；路徑別名 `@/` 指向 `src/`。

- [ ] **Step 1: 用 create-next-app 在現有資料夾建立專案**

```bash
cd "$HOME/Documents/Other Projects/aama-tennis-club-member-system"
npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --turbopack --import-alias "@/*" --yes --skip-install
npm install
```

若 create-next-app 因資料夾非空拒絕：先 `mv docs /tmp/tc-docs && mv .gitignore /tmp/tc-gitignore`，建完再搬回並合併 `.gitignore`。

- [ ] **Step 2: 安裝套件**

```bash
npm install @line/liff @supabase/supabase-js jose zod lucide-react
npm install -D vitest @vitejs/plugin-react
```

- [ ] **Step 3: 建立 vitest 設定與 smoke 測試**

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => expect(1 + 1).toBe(2));
});
```

`package.json` scripts 加：`"test": "vitest run"`, `"test:watch": "vitest"`。

- [ ] **Step 4: 補 .gitignore 與 .env.example**

`.gitignore` 追加：
```
.open-next/
.wrangler/
.dev.vars
```

`.env.example`:
```
NEXT_PUBLIC_LIFF_ID=
LINE_CHANNEL_ID=
SUPABASE_URL=
SUPABASE_SECRET_KEY=
SESSION_SECRET=
DEV_FAKE_LOGIN=1
```

- [ ] **Step 5: 驗證**

Run: `npm test` → 1 passed。Run: `npm run build` → 成功。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: Next.js 16 骨架、vitest、環境變數範例"
```

---

### Task 2: 純領域函式：場次狀態、分帳計算、統計

**Files:**
- Create: `src/lib/time.ts`, `src/lib/domain/event-status.ts`, `src/lib/domain/settlement.ts`, `src/lib/domain/stats.ts`
- Test: `tests/domain/event-status.test.ts`, `tests/domain/settlement.test.ts`, `tests/domain/stats.test.ts`

**Interfaces:**
- Produces:
  - `type EventStatus = "open" | "settled" | "cancelled"`; `type DisplayStatus = "接龍中" | "已截止" | "已結算" | "已取消"`
  - `deriveEventStatus(e: { status: EventStatus; registration_deadline: string }, now: Date): DisplayStatus`
  - `eventEndAt(e: { event_date: string; end_time: string }): Date`；`isPast(e, now)`
  - `computeSettlement(input: { finalTotal: number; attendedMemberIds: string[] }): { perPerson: number; expectedIncome: number; diff: number }`（到場 0 人丟 `Error("到場人數不可為 0")`）
  - `computeAttendance(rows: AttendanceRow[], now: Date): Map<string, number>`；`buildLeaderboard(counts, members)`
  - `time.ts`: `taipeiISO(date: string, time: string): string`（回 `YYYY-MM-DDTHH:mm:00+08:00`）、`formatTaipei(iso, opts)`、`taipeiDateString(d: Date): string`、`defaultDeadline(date, startTime): string`（前一天同時刻的 ISO）

- [ ] **Step 1: 寫 time 與 event-status 測試**

`tests/domain/event-status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { deriveEventStatus, eventEndAt, isPast } from "@/lib/domain/event-status";
import { taipeiISO, defaultDeadline, taipeiDateString } from "@/lib/time";

describe("time", () => {
  it("taipeiISO 組合 +08:00", () => {
    expect(taipeiISO("2026-09-20", "19:00")).toBe("2026-09-20T19:00:00+08:00");
  });
  it("defaultDeadline 為前一天同時刻", () => {
    expect(defaultDeadline("2026-09-20", "19:00")).toBe("2026-09-19T19:00:00+08:00");
  });
  it("taipeiDateString 以台北日期為準", () => {
    // UTC 2026-09-19 17:30 = 台北 09-20 01:30
    expect(taipeiDateString(new Date("2026-09-19T17:30:00Z"))).toBe("2026-09-20");
  });
});

describe("deriveEventStatus", () => {
  const dl = "2026-09-19T19:00:00+08:00";
  it("open 且未到截止 → 接龍中", () => {
    expect(deriveEventStatus({ status: "open", registration_deadline: dl }, new Date("2026-09-19T10:00:00+08:00"))).toBe("接龍中");
  });
  it("open 且已過截止 → 已截止", () => {
    expect(deriveEventStatus({ status: "open", registration_deadline: dl }, new Date("2026-09-19T19:00:00+08:00"))).toBe("已截止");
  });
  it("settled → 已結算；cancelled → 已取消", () => {
    expect(deriveEventStatus({ status: "settled", registration_deadline: dl }, new Date())).toBe("已結算");
    expect(deriveEventStatus({ status: "cancelled", registration_deadline: dl }, new Date())).toBe("已取消");
  });
  it("eventEndAt / isPast", () => {
    const e = { event_date: "2026-09-20", end_time: "21:00:00" };
    expect(eventEndAt(e).toISOString()).toBe("2026-09-20T13:00:00.000Z");
    expect(isPast(e, new Date("2026-09-20T13:00:01Z"))).toBe(true);
    expect(isPast(e, new Date("2026-09-20T12:59:59Z"))).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test` → FAIL（模組不存在）。

- [ ] **Step 3: 實作 time.ts 與 event-status.ts**

`src/lib/time.ts`:
```ts
export const TZ = "Asia/Taipei";

/** "HH:mm" 或 "HH:mm:ss" → "HH:mm" */
export function hm(time: string): string {
  return time.slice(0, 5);
}

export function taipeiISO(date: string, time: string): string {
  return `${date}T${hm(time)}:00+08:00`;
}

export function defaultDeadline(date: string, startTime: string): string {
  const d = new Date(taipeiISO(date, startTime));
  d.setUTCDate(d.getUTCDate() - 1);
  return `${taipeiDateString(d)}T${hm(startTime)}:00+08:00`;
}

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export function taipeiParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${hour}:${p.minute}` };
}

export function taipeiDateString(d: Date): string {
  return taipeiParts(d).date;
}

/** ISO → "2026/09/20 19:00" */
export function formatTaipei(iso: string): string {
  const { date, time } = taipeiParts(new Date(iso));
  return `${date.replaceAll("-", "/")} ${time}`;
}

export const WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** "2026-09-20" → { day: "20", weekday: "週日", month: "9月" } */
export function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00+08:00`);
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(d);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  return { day: String(Number(date.slice(8, 10))), weekday: WEEKDAYS[idx], month: `${Number(date.slice(5, 7))}月` };
}
```

`src/lib/domain/event-status.ts`:
```ts
import { taipeiISO } from "@/lib/time";

export type EventStatus = "open" | "settled" | "cancelled";
export type DisplayStatus = "接龍中" | "已截止" | "已結算" | "已取消";

export function deriveEventStatus(
  e: { status: EventStatus; registration_deadline: string },
  now: Date,
): DisplayStatus {
  if (e.status === "cancelled") return "已取消";
  if (e.status === "settled") return "已結算";
  return now.getTime() < new Date(e.registration_deadline).getTime() ? "接龍中" : "已截止";
}

export function eventEndAt(e: { event_date: string; end_time: string }): Date {
  return new Date(taipeiISO(e.event_date, e.end_time));
}

export function isPast(e: { event_date: string; end_time: string }, now: Date): boolean {
  return now.getTime() > eventEndAt(e).getTime();
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test` → event-status 全綠。

- [ ] **Step 5: 寫 settlement 測試**

`tests/domain/settlement.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeSettlement } from "@/lib/domain/settlement";

describe("computeSettlement", () => {
  it("整除", () => {
    expect(computeSettlement({ finalTotal: 2500, attendedMemberIds: ["a", "b", "c", "d", "e"] }))
      .toEqual({ perPerson: 500, expectedIncome: 2500, diff: 0 });
  });
  it("不整除時無條件進位，diff 為多收", () => {
    expect(computeSettlement({ finalTotal: 1000, attendedMemberIds: ["a", "b", "c"] }))
      .toEqual({ perPerson: 334, expectedIncome: 1002, diff: 2 });
  });
  it("到場 0 人丟錯", () => {
    expect(() => computeSettlement({ finalTotal: 100, attendedMemberIds: [] })).toThrow("到場人數不可為 0");
  });
  it("總額為負或非整數丟錯", () => {
    expect(() => computeSettlement({ finalTotal: -1, attendedMemberIds: ["a"] })).toThrow();
    expect(() => computeSettlement({ finalTotal: 10.5, attendedMemberIds: ["a"] })).toThrow();
  });
});
```

- [ ] **Step 6: 實作 settlement.ts**

```ts
export type SettlementInput = { finalTotal: number; attendedMemberIds: string[] };
export type SettlementResult = { perPerson: number; expectedIncome: number; diff: number };

export function computeSettlement({ finalTotal, attendedMemberIds }: SettlementInput): SettlementResult {
  if (!Number.isInteger(finalTotal) || finalTotal < 0) throw new Error("總金額必須是非負整數");
  const n = new Set(attendedMemberIds).size;
  if (n === 0) throw new Error("到場人數不可為 0");
  const perPerson = Math.ceil(finalTotal / n);
  const expectedIncome = perPerson * n;
  return { perPerson, expectedIncome, diff: expectedIncome - finalTotal };
}
```

- [ ] **Step 7: 寫 stats 測試**

`tests/domain/stats.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeAttendance, buildLeaderboard, type AttendanceRow } from "@/lib/domain/stats";

const now = new Date("2026-09-13T12:00:00+08:00");
const past = { event_date: "2026-09-06", end_time: "21:00:00" };
const future = { event_date: "2026-09-20", end_time: "21:00:00" };

describe("computeAttendance", () => {
  it("已結算只算 attended=true", () => {
    const rows: AttendanceRow[] = [
      { member_id: "a", event_status: "settled", reg_status: "confirmed", attended: true, ...past },
      { member_id: "b", event_status: "settled", reg_status: "confirmed", attended: false, ...past },
    ];
    const m = computeAttendance(rows, now);
    expect(m.get("a")).toBe(1);
    expect(m.get("b") ?? 0).toBe(0);
  });
  it("open 且已過期的正取暫計，候補與未來場次不計", () => {
    const rows: AttendanceRow[] = [
      { member_id: "a", event_status: "open", reg_status: "confirmed", attended: null, ...past },
      { member_id: "b", event_status: "open", reg_status: "waitlisted", attended: null, ...past },
      { member_id: "c", event_status: "open", reg_status: "confirmed", attended: null, ...future },
    ];
    const m = computeAttendance(rows, now);
    expect(m.get("a")).toBe(1);
    expect(m.get("b") ?? 0).toBe(0);
    expect(m.get("c") ?? 0).toBe(0);
  });
  it("cancelled 不計", () => {
    const m = computeAttendance([{ member_id: "a", event_status: "cancelled", reg_status: "confirmed", attended: true, ...past }], now);
    expect(m.get("a") ?? 0).toBe(0);
  });
});

describe("buildLeaderboard", () => {
  it("依場數降序，同分依名稱", () => {
    const counts = new Map([["a", 3], ["b", 5], ["c", 3]]);
    const members = [
      { id: "a", display_name: "小明", picture_url: null },
      { id: "b", display_name: "小華", picture_url: null },
      { id: "c", display_name: "小美", picture_url: null },
      { id: "d", display_name: "沒來過", picture_url: null },
    ];
    const lb = buildLeaderboard(counts, members);
    expect(lb.map((x) => x.member.id)).toEqual(["b", "a", "c"]);
    expect(lb[0]).toMatchObject({ rank: 1, count: 5 });
  });
});
```

- [ ] **Step 8: 實作 stats.ts**

```ts
import { isPast } from "@/lib/domain/event-status";
import type { EventStatus } from "@/lib/domain/event-status";

export type AttendanceRow = {
  member_id: string;
  event_status: EventStatus;
  reg_status: "confirmed" | "waitlisted";
  attended: boolean | null;
  event_date: string;
  end_time: string;
};

export function countsAsAttended(r: AttendanceRow, now: Date): boolean {
  if (r.event_status === "cancelled") return false;
  if (r.event_status === "settled") return r.attended === true;
  return r.reg_status === "confirmed" && isPast(r, now);
}

export function computeAttendance(rows: AttendanceRow[], now: Date): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) if (countsAsAttended(r, now)) m.set(r.member_id, (m.get(r.member_id) ?? 0) + 1);
  return m;
}

export type LeaderMember = { id: string; display_name: string; picture_url: string | null };
export type LeaderboardEntry = { rank: number; count: number; member: LeaderMember };

export function buildLeaderboard(counts: Map<string, number>, members: LeaderMember[]): LeaderboardEntry[] {
  return members
    .filter((m) => (counts.get(m.id) ?? 0) > 0)
    .map((m) => ({ member: m, count: counts.get(m.id)! }))
    .sort((a, b) => b.count - a.count || a.member.display_name.localeCompare(b.member.display_name, "zh-Hant"))
    .map((x, i) => ({ rank: i + 1, ...x }));
}
```

- [ ] **Step 9: 全部測試通過後 commit**

Run: `npm test` → 全綠。
```bash
git add -A && git commit -m "feat(domain): 時間工具、場次狀態推導、分帳計算、出席統計"
```

---
### Task 3: Supabase 專案、資料表、原子性函式

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `supabase/migrations/0002_functions.sql`, `src/lib/env.ts`, `src/lib/db/admin.ts`, `src/lib/db/types.ts`
- Test: `tests/db/registration-functions.test.ts`（有 `SUPABASE_URL` 與 `SUPABASE_SECRET_KEY` 才跑，否則 skip）

**Interfaces:**
- Produces:
  - Postgres functions（皆 `security definer`）：
    - `register_for_event(p_event_id uuid, p_member_id uuid, p_actor_id uuid) returns registrations`
    - `cancel_registration(p_event_id uuid, p_member_id uuid, p_actor_id uuid) returns void`
    - `set_event_capacity(p_event_id uuid, p_capacity int) returns void`
    - `settle_event(p_event_id uuid, p_final_total int, p_attended uuid[]) returns void`
  - `admin()`：回傳 Supabase client（`src/lib/db/admin.ts`）
  - `env`：`env.SUPABASE_URL`、`env.SUPABASE_SECRET_KEY`、`env.SESSION_SECRET`、`env.LINE_CHANNEL_ID`、`env.DEV_FAKE_LOGIN`
  - 型別 `Member`、`Venue`、`EventRow`、`Registration`

- [ ] **Step 1（用戶操作，一步一步帶）: 在 Bridge org 建 Supabase 專案**

1. 開 https://supabase.com/dashboard/org/trfgfftugwlwnpqdwnnr → New project。
2. Name `tennis-club`，Region `Northeast Asia (Tokyo)`，資料庫密碼用產生器並存到密碼管理器。
3. 建好後到 Project Settings → API Keys → 「Publishable and secret」分頁：複製 Project URL 與 `sb_secret_…`（按 Reveal）。
4. 本機建立 `.env.local`：
```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SESSION_SECRET=<用 openssl rand -base64 32 產生>
DEV_FAKE_LOGIN=1
```

- [ ] **Step 2: 寫 schema migration**

`supabase/migrations/0001_schema.sql`:
```sql
create extension if not exists pgcrypto;

create type member_role as enum ('member', 'admin');
create type event_status as enum ('open', 'settled', 'cancelled');
create type registration_status as enum ('confirmed', 'waitlisted');

create table members (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  display_name text not null,
  picture_url text,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  last_login_at timestamptz not null default now()
);

create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  is_active boolean not null default true,
  created_by uuid references members(id),
  created_at timestamptz not null default now()
);

create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  event_date date not null,
  start_time time not null,
  end_time time not null,
  venue_id uuid not null references venues(id),
  capacity int not null default 8 check (capacity >= 1),
  registration_deadline timestamptz not null,
  estimated_total int check (estimated_total is null or estimated_total >= 0),
  final_total int check (final_total is null or final_total >= 0),
  status event_status not null default 'open',
  organizer_id uuid not null references members(id),
  settled_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);
create index events_date_idx on events(event_date);
create index events_organizer_idx on events(organizer_id);

create table registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  member_id uuid not null references members(id),
  status registration_status not null,
  waitlist_position int,
  attended boolean,
  amount_due int,
  paid_at timestamptz,
  paid_amount int,
  paid_marked_by uuid references members(id),
  created_at timestamptz not null default now(),
  unique (event_id, member_id)
);
create index registrations_member_idx on registrations(member_id);

-- 全表 RLS 開啟、不設 policy：前端與 anon/authenticated 無法存取
alter table members enable row level security;
alter table venues enable row level security;
alter table events enable row level security;
alter table registrations enable row level security;

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger events_updated_at before update on events for each row execute function set_updated_at();
```

- [ ] **Step 3: 寫 functions migration**

`supabase/migrations/0002_functions.sql`:
```sql
-- 內部：把候補依序遞補到正取，直到額滿
create or replace function promote_waitlist(p_event_id uuid) returns void
language plpgsql security definer as $$
declare v_capacity int; v_confirmed int; v_next uuid;
begin
  select capacity into v_capacity from events where id = p_event_id;
  loop
    select count(*) into v_confirmed from registrations where event_id = p_event_id and status = 'confirmed';
    exit when v_confirmed >= v_capacity;
    select id into v_next from registrations
      where event_id = p_event_id and status = 'waitlisted'
      order by waitlist_position asc limit 1;
    exit when v_next is null;
    update registrations set status = 'confirmed', waitlist_position = null where id = v_next;
  end loop;
end $$;

create or replace function is_organizer_or_admin(p_event_id uuid, p_actor_id uuid) returns boolean
language sql security definer as $$
  select exists (
    select 1 from events e join members m on m.id = p_actor_id
    where e.id = p_event_id and (e.organizer_id = p_actor_id or m.role = 'admin')
  );
$$;

create or replace function register_for_event(p_event_id uuid, p_member_id uuid, p_actor_id uuid)
returns registrations language plpgsql security definer as $$
declare v_event events%rowtype; v_confirmed int; v_pos int; v_row registrations%rowtype;
begin
  select * into v_event from events where id = p_event_id for update;
  if not found then raise exception '場次不存在'; end if;
  if v_event.status <> 'open' then raise exception '場次已結算或取消'; end if;
  if now() >= v_event.registration_deadline and not is_organizer_or_admin(p_event_id, p_actor_id) then
    raise exception '已超過結束報名時間';
  end if;
  if exists (select 1 from registrations where event_id = p_event_id and member_id = p_member_id) then
    raise exception '已經報名過了';
  end if;
  select count(*) into v_confirmed from registrations where event_id = p_event_id and status = 'confirmed';
  if v_confirmed < v_event.capacity then
    insert into registrations (event_id, member_id, status) values (p_event_id, p_member_id, 'confirmed') returning * into v_row;
  else
    select coalesce(max(waitlist_position), 0) + 1 into v_pos from registrations where event_id = p_event_id and status = 'waitlisted';
    insert into registrations (event_id, member_id, status, waitlist_position) values (p_event_id, p_member_id, 'waitlisted', v_pos) returning * into v_row;
  end if;
  return v_row;
end $$;

create or replace function cancel_registration(p_event_id uuid, p_member_id uuid, p_actor_id uuid)
returns void language plpgsql security definer as $$
declare v_event events%rowtype; v_status registration_status;
begin
  select * into v_event from events where id = p_event_id for update;
  if not found then raise exception '場次不存在'; end if;
  if v_event.status <> 'open' then raise exception '場次已結算或取消'; end if;
  if now() >= v_event.registration_deadline and not is_organizer_or_admin(p_event_id, p_actor_id) then
    raise exception '已超過結束報名時間';
  end if;
  delete from registrations where event_id = p_event_id and member_id = p_member_id returning status into v_status;
  if v_status = 'confirmed' then perform promote_waitlist(p_event_id); end if;
end $$;

create or replace function set_event_capacity(p_event_id uuid, p_capacity int)
returns void language plpgsql security definer as $$
begin
  perform 1 from events where id = p_event_id for update;
  update events set capacity = p_capacity where id = p_event_id;
  perform promote_waitlist(p_event_id);
end $$;

create or replace function settle_event(p_event_id uuid, p_final_total int, p_attended uuid[])
returns void language plpgsql security definer as $$
declare v_n int; v_per int;
begin
  perform 1 from events where id = p_event_id and status <> 'cancelled' for update;
  if not found then raise exception '場次不存在或已取消'; end if;
  select count(*) into v_n from registrations where event_id = p_event_id and member_id = any(p_attended);
  if v_n = 0 then raise exception '到場人數不可為 0'; end if;
  v_per := ceil(p_final_total::numeric / v_n);
  update registrations set
    attended = (member_id = any(p_attended)),
    amount_due = case when member_id = any(p_attended) then v_per else 0 end
  where event_id = p_event_id;
  update events set status = 'settled', final_total = p_final_total, settled_at = now() where id = p_event_id;
end $$;
```

- [ ] **Step 4: 套用到 dev 專案**

用 supabase CLI（已安裝）：
```bash
cd "$HOME/Documents/Other Projects/aama-tennis-club-member-system"
supabase link --project-ref <ref>
supabase db push
```
若 `db push` 抱怨 migration 檔名格式，改名為 `20260913000001_schema.sql`、`20260913000002_functions.sql`。另一條路：在 Dashboard SQL Editor 依序貼上兩個檔案執行。

- [ ] **Step 5: env.ts、admin client、型別**

`src/lib/env.ts`:
```ts
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
export const env = {
  get SUPABASE_URL() { return req("SUPABASE_URL"); },
  get SUPABASE_SECRET_KEY() { return req("SUPABASE_SECRET_KEY"); },
  get SESSION_SECRET() { return req("SESSION_SECRET"); },
  get LINE_CHANNEL_ID() { return req("LINE_CHANNEL_ID"); },
  get DEV_FAKE_LOGIN() { return process.env.DEV_FAKE_LOGIN === "1"; },
};
```

`src/lib/db/admin.ts`:
```ts
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let client: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
```
（測試檔不能 import `server-only`，測試裡直接 `createClient`。）

`src/lib/db/types.ts`:
```ts
import type { EventStatus } from "@/lib/domain/event-status";
export type Member = { id: string; line_user_id: string; display_name: string; picture_url: string | null; role: "member" | "admin"; created_at: string; last_login_at: string };
export type Venue = { id: string; name: string; address: string | null; is_active: boolean; created_by: string | null };
export type EventRow = { id: string; title: string; event_date: string; start_time: string; end_time: string; venue_id: string; capacity: number; registration_deadline: string; estimated_total: number | null; final_total: number | null; status: EventStatus; organizer_id: string; settled_at: string | null; note: string | null; created_at: string; updated_at: string };
export type Registration = { id: string; event_id: string; member_id: string; status: "confirmed" | "waitlisted"; waitlist_position: number | null; attended: boolean | null; amount_due: number | null; paid_at: string | null; paid_amount: number | null; paid_marked_by: string | null; created_at: string };
```

- [ ] **Step 6: 寫函式整合測試**

`tests/db/registration-functions.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
const run = url && key ? describe : describe.skip;

run("registration functions", () => {
  const sb = createClient(url!, key!, { auth: { persistSession: false } });
  const ids: string[] = []; let venueId = ""; let eventId = "";
  const mk = async (n: string) => {
    const { data } = await sb.from("members").insert({ line_user_id: `test-${n}-${Date.now()}`, display_name: n }).select().single();
    ids.push(data!.id); return data!.id as string;
  };
  beforeAll(async () => {
    const org = await mk("org"), a = await mk("a"), b = await mk("b"), c = await mk("c");
    const v = await sb.from("venues").insert({ name: "測試場地", created_by: org }).select().single(); venueId = v.data!.id;
    const e = await sb.from("events").insert({ title: "測試", event_date: "2030-01-01", start_time: "19:00", end_time: "21:00", venue_id: venueId, capacity: 2, registration_deadline: "2029-12-31T19:00:00+08:00", organizer_id: org }).select().single();
    eventId = e.data!.id;
    for (const m of [org, a, b, c]) {
      const r = await sb.rpc("register_for_event", { p_event_id: eventId, p_member_id: m, p_actor_id: m });
      expect(r.error).toBeNull();
    }
  });
  afterAll(async () => {
    await sb.from("events").delete().eq("id", eventId);
    await sb.from("venues").delete().eq("id", venueId);
    await sb.from("members").delete().in("id", ids);
  });
  it("前兩位正取，後兩位候補且順序正確", async () => {
    const { data } = await sb.from("registrations").select("member_id,status,waitlist_position").eq("event_id", eventId);
    expect(data!.filter((r) => r.status === "confirmed")).toHaveLength(2);
    expect(data!.filter((r) => r.status === "waitlisted").map((r) => r.waitlist_position).sort()).toEqual([1, 2]);
  });
  it("重複報名丟錯", async () => {
    const r = await sb.rpc("register_for_event", { p_event_id: eventId, p_member_id: ids[0], p_actor_id: ids[0] });
    expect(r.error?.message).toContain("已經報名過了");
  });
  it("正取取消後候補第一位遞補", async () => {
    await sb.rpc("cancel_registration", { p_event_id: eventId, p_member_id: ids[0], p_actor_id: ids[0] });
    const { data } = await sb.from("registrations").select("member_id,status").eq("event_id", eventId).eq("member_id", ids[2]).single();
    expect(data!.status).toBe("confirmed");
  });
  it("調高名額自動遞補", async () => {
    await sb.rpc("set_event_capacity", { p_event_id: eventId, p_capacity: 3 });
    const { data } = await sb.from("registrations").select("status").eq("event_id", eventId).eq("status", "waitlisted");
    expect(data).toHaveLength(0);
  });
  it("結算：2 人到場 1000 元 → 每人 500，未到場 0", async () => {
    const r = await sb.rpc("settle_event", { p_event_id: eventId, p_final_total: 1000, p_attended: [ids[1], ids[2]] });
    expect(r.error).toBeNull();
    const { data } = await sb.from("registrations").select("member_id,attended,amount_due").eq("event_id", eventId);
    expect(data!.find((x) => x.member_id === ids[1])).toMatchObject({ attended: true, amount_due: 500 });
    expect(data!.find((x) => x.member_id === ids[3])).toMatchObject({ attended: false, amount_due: 0 });
    const ev = await sb.from("events").select("status,final_total").eq("id", eventId).single();
    expect(ev.data).toMatchObject({ status: "settled", final_total: 1000 });
  });
  it("結算後不能再報名", async () => {
    const r = await sb.rpc("register_for_event", { p_event_id: eventId, p_member_id: ids[0], p_actor_id: ids[0] });
    expect(r.error?.message).toContain("已結算");
  });
});
```

- [ ] **Step 7: 跑測試**

Run: `set -a; source .env.local; set +a; npm test` → db 測試全綠（沒有環境變數時顯示 skipped）。

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat(db): schema、RLS、報名／遞補／結算 Postgres functions、admin client"
```

---

### Task 4: Session cookie 與目前成員

**Files:**
- Create: `src/lib/auth/session.ts`, `src/lib/auth/current-member.ts`
- Test: `tests/auth/session.test.ts`

**Interfaces:**
- Produces:
  - `signSession(memberId: string, secret: string): Promise<string>`、`verifySession(token: string, secret: string): Promise<string | null>`、`SESSION_COOKIE = "tc_session"`、`SESSION_MAX_AGE = 60*60*24*30`
  - `getCurrentMember(): Promise<Member | null>`、`requireMember(): Promise<Member>`（未登入 `redirect("/login")`）、`requireAdmin(): Promise<Member>`、`isAdmin(m)`

- [ ] **Step 1: 寫測試**

`tests/auth/session.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

describe("session", () => {
  const secret = "test-secret-at-least-32-characters-long!!";
  it("簽發後可驗證取回 member id", async () => {
    const t = await signSession("m-1", secret);
    expect(await verifySession(t, secret)).toBe("m-1");
  });
  it("錯的 secret 回 null", async () => {
    const t = await signSession("m-1", secret);
    expect(await verifySession(t, "another-secret-that-is-also-long-enough")).toBeNull();
  });
  it("亂字串回 null", async () => {
    expect(await verifySession("garbage", secret)).toBeNull();
  });
});
```

- [ ] **Step 2: 實作 session.ts**

```ts
import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "tc_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

const key = (s: string) => new TextEncoder().encode(s);

export async function signSession(memberId: string, secret: string): Promise<string> {
  return new SignJWT({ mid: memberId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key(secret));
}

export async function verifySession(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    return typeof payload.mid === "string" ? payload.mid : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: 實作 current-member.ts**

```ts
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { admin } from "@/lib/db/admin";
import { env } from "@/lib/env";
import type { Member } from "@/lib/db/types";
import { SESSION_COOKIE, verifySession } from "./session";

export const getCurrentMember = cache(async (): Promise<Member | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const mid = await verifySession(token, env.SESSION_SECRET);
  if (!mid) return null;
  const { data } = await admin().from("members").select("*").eq("id", mid).maybeSingle();
  return (data as Member) ?? null;
});

export async function requireMember(): Promise<Member> {
  const m = await getCurrentMember();
  if (!m) redirect("/login");
  return m;
}

export const isAdmin = (m: Member) => m.role === "admin";

export async function requireAdmin(): Promise<Member> {
  const m = await requireMember();
  if (!isAdmin(m)) throw new Error("需要管理員權限");
  return m;
}
```

- [ ] **Step 4: 測試與 commit**

Run: `npm test` → session 測試綠。
```bash
git add -A && git commit -m "feat(auth): 簽章 session cookie 與目前成員取得"
```

---

### Task 5: LINE 登入（LIFF）、假登入、登出、登入頁

**Files:**
- Create: `src/lib/auth/line.ts`, `src/app/api/auth/line/route.ts`, `src/app/api/auth/dev-login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/components/LiffLogin.tsx`, `src/app/login/page.tsx`
- Test: `tests/auth/line.test.ts`

**Interfaces:**
- Produces:
  - `verifyLineIdToken(idToken: string, channelId: string, fetchFn?: typeof fetch): Promise<{ sub: string; name: string; picture: string | null }>`（失敗丟 Error，訊息含 LINE 回的 error_description）
  - `POST /api/auth/line` body `{ idToken }` → 200 `{ ok: true }` 並設 cookie；401 `{ error }`
  - `GET /api/auth/dev-login?name=xxx&admin=1`（只在 DEV_FAKE_LOGIN=1）→ 設 cookie 後導向 `/`
  - `POST /api/auth/logout` → 清 cookie

- [ ] **Step 1: 寫 verifyLineIdToken 測試**

`tests/auth/line.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { verifyLineIdToken } from "@/lib/auth/line";

describe("verifyLineIdToken", () => {
  it("成功回傳 sub/name/picture，並以 form 送 id_token 與 client_id", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toBe("id_token=tok&client_id=123");
      return new Response(JSON.stringify({ sub: "U1", name: "小明", picture: "https://p" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await verifyLineIdToken("tok", "123", fetchFn);
    expect(r).toEqual({ sub: "U1", name: "小明", picture: "https://p" });
  });
  it("LINE 回 400 時丟出 error_description", async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: "invalid_request", error_description: "IdToken expired." }), { status: 400 })) as unknown as typeof fetch;
    await expect(verifyLineIdToken("tok", "123", fetchFn)).rejects.toThrow("IdToken expired.");
  });
});
```

- [ ] **Step 2: 實作 line.ts**

```ts
export type LineProfile = { sub: string; name: string; picture: string | null };

export async function verifyLineIdToken(idToken: string, channelId: string, fetchFn: typeof fetch = fetch): Promise<LineProfile> {
  const body = new URLSearchParams({ id_token: idToken, client_id: channelId }).toString();
  const res = await fetchFn("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json()) as { sub?: string; name?: string; picture?: string; error_description?: string };
  if (!res.ok || !json.sub) throw new Error(json.error_description ?? "LINE 驗證失敗");
  return { sub: json.sub, name: json.name ?? "LINE 使用者", picture: json.picture ?? null };
}
```

- [ ] **Step 3: 跑測試通過**

Run: `npm test` → line 測試綠。

- [ ] **Step 4: 三個 route handlers**

`src/app/api/auth/line/route.ts`:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyLineIdToken } from "@/lib/auth/line";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { admin } from "@/lib/db/admin";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const { idToken } = (await req.json().catch(() => ({}))) as { idToken?: string };
  if (!idToken) return NextResponse.json({ error: "缺少 idToken" }, { status: 400 });
  let profile;
  try {
    profile = await verifyLineIdToken(idToken, env.LINE_CHANNEL_ID);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 401 });
  }
  const { data, error } = await admin()
    .from("members")
    .upsert(
      { line_user_id: profile.sub, display_name: profile.name, picture_url: profile.picture, last_login_at: new Date().toISOString() },
      { onConflict: "line_user_id" },
    )
    .select("id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "建立成員失敗" }, { status: 500 });
  const token = await signSession(data.id, env.SESSION_SECRET);
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return NextResponse.json({ ok: true });
}
```

`src/app/api/auth/dev-login/route.ts`:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { signSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { admin } from "@/lib/db/admin";
import { env } from "@/lib/env";

export async function GET(req: Request) {
  if (!env.DEV_FAKE_LOGIN) return NextResponse.json({ error: "not enabled" }, { status: 404 });
  const url = new URL(req.url);
  const name = url.searchParams.get("name") ?? "測試成員";
  const role = url.searchParams.get("admin") === "1" ? "admin" : "member";
  const { data, error } = await admin()
    .from("members")
    .upsert({ line_user_id: `dev-${name}`, display_name: name, role, last_login_at: new Date().toISOString() }, { onConflict: "line_user_id" })
    .select("id").single();
  if (error || !data) return NextResponse.json({ error: error?.message }, { status: 500 });
  (await cookies()).set(SESSION_COOKIE, await signSession(data.id, env.SESSION_SECRET), { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_MAX_AGE });
  return NextResponse.redirect(new URL("/", req.url));
}
```

`src/app/api/auth/logout/route.ts`:
```ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";

export async function POST(req: Request) {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
```

- [ ] **Step 5: LiffLogin 元件與登入頁**

`src/components/LiffLogin.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type State = "init" | "verifying" | "error";

export default function LiffLogin({ liffId, devLogin }: { liffId: string | null; devLogin: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<State>("init");
  const [msg, setMsg] = useState("");

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
          const j = await res.json().catch(() => ({}));
          if (String(j.error ?? "").toLowerCase().includes("expired")) { liff.logout(); liff.login({ redirectUri: window.location.href }); return; }
          throw new Error(j.error ?? "登入失敗");
        }
        if (!cancelled) router.replace("/");
      } catch (e) {
        if (!cancelled) { setState("error"); setMsg((e as Error).message); }
      }
    })();
    return () => { cancelled = true; };
  }, [liffId, router]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">網球社</h1>
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
```

`src/app/login/page.tsx`:
```tsx
import { redirect } from "next/navigation";
import LiffLogin from "@/components/LiffLogin";
import { getCurrentMember } from "@/lib/auth/current-member";
import { env } from "@/lib/env";

export default async function LoginPage() {
  if (await getCurrentMember()) redirect("/");
  return <LiffLogin liffId={process.env.NEXT_PUBLIC_LIFF_ID ?? null} devLogin={env.DEV_FAKE_LOGIN} />;
}
```

- [ ] **Step 6: 手動驗證**

Run: `npm run dev`，開 http://localhost:3000/login → 看到假登入按鈕 → 按「以測試成員登入」→ 導回 `/`（此時首頁還是預設頁，只要 cookie 有設即可：DevTools → Application → Cookies 看到 `tc_session`）。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(auth): LIFF 登入、LINE id_token 驗證、假登入、登出"
```

---
### Task 6: App 外殼：需登入 layout、頂部列、底部分頁、共用元件、讀取查詢

**Files:**
- Create: `src/app/(tabs)/layout.tsx`, `src/components/Header.tsx`, `src/components/BottomNav.tsx`, `src/components/Avatar.tsx`, `src/components/StatusBadge.tsx`, `src/components/CapacityBar.tsx`, `src/components/EventCard.tsx`, `src/lib/db/queries.ts`
- Modify: `src/app/layout.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces（`queries.ts`，全部 server-only）:
  - `type EventWithCounts = EventRow & { venue: Venue; organizer: Pick<Member,"id"|"display_name"|"picture_url">; confirmed_count: number; waitlist_count: number }`
  - `listEvents(): Promise<EventWithCounts[]>`（不含 cancelled，依 event_date、start_time 升序）
  - `getEvent(id): Promise<EventWithCounts | null>`
  - `listRegistrations(eventId): Promise<(Registration & { member: Pick<Member,"id"|"display_name"|"picture_url"> })[]>`（正取先、候補依 position）
  - `listActiveVenues(): Promise<Venue[]>`、`listAllVenues()`
  - `listMembers(): Promise<Pick<Member,"id"|"display_name"|"picture_url">[]>`
  - `listMyRegistrations(memberId)`：回 `(Registration & { event: EventWithCounts })[]`
  - `listAttendanceRows(): Promise<AttendanceRow[]>`、`sumPaid(): Promise<number>`
- 元件：`<EventCard event href />`、`<CapacityBar confirmed capacity waitlist />`、`<StatusBadge status: DisplayStatus />`、`<Avatar src name size />`

- [ ] **Step 1: 全域樣式與根 layout**

`src/app/globals.css`（Tailwind 4）:
```css
@import "tailwindcss";
:root { --bg: #eef1f6; --card: #ffffff; --primary: #2563eb; }
body { background: var(--bg); color: #111827; }
```

`src/app/layout.tsx`:
```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "網球社", description: "AAMA 網球社 開場接龍" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body className="mx-auto min-h-dvh max-w-md antialiased">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: queries.ts**

```ts
import "server-only";
import { admin } from "./admin";
import type { EventRow, Member, Registration, Venue } from "./types";
import type { AttendanceRow } from "@/lib/domain/stats";

export type MemberLite = Pick<Member, "id" | "display_name" | "picture_url">;
export type EventWithCounts = EventRow & { venue: Venue; organizer: MemberLite; confirmed_count: number; waitlist_count: number };
export type RegistrationWithMember = Registration & { member: MemberLite };

const EVENT_SELECT = "*, venue:venues(*), organizer:members!events_organizer_id_fkey(id,display_name,picture_url), registrations(status)";

type Raw = EventRow & { venue: Venue; organizer: MemberLite; registrations: { status: string }[] };
function withCounts(r: Raw): EventWithCounts {
  const { registrations, ...rest } = r;
  return { ...rest, confirmed_count: registrations.filter((x) => x.status === "confirmed").length, waitlist_count: registrations.filter((x) => x.status === "waitlisted").length };
}

export async function listEvents(): Promise<EventWithCounts[]> {
  const { data, error } = await admin().from("events").select(EVENT_SELECT).neq("status", "cancelled").order("event_date").order("start_time");
  if (error) throw error;
  return (data as unknown as Raw[]).map(withCounts);
}

export async function listEventsByOrganizer(memberId: string | null): Promise<EventWithCounts[]> {
  let q = admin().from("events").select(EVENT_SELECT).order("event_date", { ascending: false }).order("start_time");
  if (memberId) q = q.eq("organizer_id", memberId);
  const { data, error } = await q;
  if (error) throw error;
  return (data as unknown as Raw[]).map(withCounts);
}

export async function getEvent(id: string): Promise<EventWithCounts | null> {
  const { data, error } = await admin().from("events").select(EVENT_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? withCounts(data as unknown as Raw) : null;
}

export async function listRegistrations(eventId: string): Promise<RegistrationWithMember[]> {
  const { data, error } = await admin().from("registrations").select("*, member:members(id,display_name,picture_url)").eq("event_id", eventId)
    .order("status", { ascending: true }).order("waitlist_position", { ascending: true, nullsFirst: true }).order("created_at");
  if (error) throw error;
  return data as unknown as RegistrationWithMember[];
}

export async function listActiveVenues(): Promise<Venue[]> {
  const { data, error } = await admin().from("venues").select("*").eq("is_active", true).order("name");
  if (error) throw error; return data as Venue[];
}
export async function listAllVenues(): Promise<Venue[]> {
  const { data, error } = await admin().from("venues").select("*").order("is_active", { ascending: false }).order("name");
  if (error) throw error; return data as Venue[];
}
export async function listMembers(): Promise<MemberLite[]> {
  const { data, error } = await admin().from("members").select("id,display_name,picture_url").order("display_name");
  if (error) throw error; return data as MemberLite[];
}

export type MyRegistration = Registration & { event: EventWithCounts };
export async function listMyRegistrations(memberId: string): Promise<MyRegistration[]> {
  const { data, error } = await admin().from("registrations").select(`*, event:events(${EVENT_SELECT})`).eq("member_id", memberId);
  if (error) throw error;
  return (data as unknown as (Registration & { event: Raw })[]).map((r) => ({ ...r, event: withCounts(r.event) }));
}

export async function listAttendanceRows(): Promise<AttendanceRow[]> {
  const { data, error } = await admin().from("registrations").select("member_id,status,attended,event:events(status,event_date,end_time)");
  if (error) throw error;
  return (data as unknown as { member_id: string; status: "confirmed" | "waitlisted"; attended: boolean | null; event: { status: AttendanceRow["event_status"]; event_date: string; end_time: string } }[])
    .map((r) => ({ member_id: r.member_id, reg_status: r.status, attended: r.attended, event_status: r.event.status, event_date: r.event.event_date, end_time: r.event.end_time }));
}

export async function sumPaid(): Promise<number> {
  const { data, error } = await admin().from("registrations").select("paid_amount").not("paid_at", "is", null);
  if (error) throw error;
  return (data as { paid_amount: number | null }[]).reduce((s, r) => s + (r.paid_amount ?? 0), 0);
}
```
（`registrations(status)` 的 status enum 排序：Postgres enum 依宣告順序，confirmed 在 waitlisted 前，所以 `order("status")` 正取在前。）

- [ ] **Step 3: 共用元件**

`src/components/Avatar.tsx`:
```tsx
export default function Avatar({ src, name, size = 36 }: { src: string | null; name: string; size?: number }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <div className="flex items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700" style={{ width: size, height: size, fontSize: size * 0.4 }}>{name.slice(0, 1)}</div>
  );
}
```

`src/components/StatusBadge.tsx`:
```tsx
import type { DisplayStatus } from "@/lib/domain/event-status";
const styles: Record<DisplayStatus, string> = {
  接龍中: "bg-green-50 text-green-700", 已截止: "bg-amber-50 text-amber-700", 已結算: "bg-blue-50 text-blue-700", 已取消: "bg-gray-100 text-gray-500",
};
export default function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>● {status}</span>;
}
```

`src/components/CapacityBar.tsx`:
```tsx
export default function CapacityBar({ confirmed, capacity, waitlist }: { confirmed: number; capacity: number; waitlist: number }) {
  const full = confirmed >= capacity;
  const pct = Math.min(100, Math.round((confirmed / capacity) * 100));
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${full ? "bg-orange-400" : "bg-blue-600"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold">{confirmed}/{capacity}</span>
      {waitlist > 0 && <span className="text-sm font-bold text-orange-500">候補{waitlist}</span>}
    </div>
  );
}
```

`src/components/EventCard.tsx`:
```tsx
import Link from "next/link";
import { Clock, MapPin } from "lucide-react";
import type { EventWithCounts } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import { dateParts, hm } from "@/lib/time";
import CapacityBar from "./CapacityBar";
import StatusBadge from "./StatusBadge";

export default function EventCard({ event, href, now }: { event: EventWithCounts; href: string; now: Date }) {
  const d = dateParts(event.event_date);
  const status = deriveEventStatus(event, now);
  return (
    <Link href={href} className="block rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex gap-4">
        <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-blue-50 py-2 text-blue-700">
          <span className="text-2xl font-black">{d.day}</span>
          <span className="text-xs">{d.weekday}</span>
          <span className="text-xs">{d.month}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-lg font-bold">{event.title}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 flex items-center gap-1 text-sm text-gray-500"><Clock size={14} />{hm(event.start_time)}–{hm(event.end_time)}</p>
          <p className="flex items-center gap-1 text-sm text-gray-500"><MapPin size={14} />{event.venue.name}</p>
          <div className="mt-3"><CapacityBar confirmed={event.confirmed_count} capacity={event.capacity} waitlist={event.waitlist_count} /></div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 4: Header、BottomNav、(tabs) layout**

`src/components/Header.tsx`:
```tsx
import Avatar from "./Avatar";
import type { Member } from "@/lib/db/types";

export default function Header({ member }: { member: Member }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between bg-white px-4 py-3 shadow-sm">
      <div>
        <div className="text-lg font-bold">網球社</div>
        <div className="text-xs tracking-wider text-gray-400">AAMA 台北搖籃計畫</div>
      </div>
      <form action="/api/auth/logout" method="post">
        <button className="flex items-center gap-2 rounded-full border px-2 py-1" title="登出">
          <Avatar src={member.picture_url} name={member.display_name} size={28} />
          <span className="text-sm font-semibold">{member.display_name}</span>
        </button>
      </form>
    </header>
  );
}
```

`src/components/BottomNav.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, User, BarChart3, Settings } from "lucide-react";

const tabs = [
  { href: "/", label: "場次", Icon: CalendarDays },
  { href: "/me", label: "我的", Icon: User },
  { href: "/stats", label: "統計", Icon: BarChart3 },
  { href: "/manage", label: "管理", Icon: Settings },
];

export default function BottomNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md justify-around border-t bg-white py-2">
      {tabs.map(({ href, label, Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href);
        return (
          <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 px-4 text-xs ${active ? "font-bold text-blue-600" : "text-gray-400"}`}>
            <Icon size={20} />{label}
          </Link>
        );
      })}
    </nav>
  );
}
```

`src/app/(tabs)/layout.tsx`:
```tsx
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import { requireMember } from "@/lib/auth/current-member";

export default async function TabsLayout({ children }: { children: React.ReactNode }) {
  const member = await requireMember();
  return (
    <>
      <Header member={member} />
      <main className="px-4 pb-24 pt-4">{children}</main>
      <BottomNav />
    </>
  );
}
```

暫時建立四個佔位頁讓導覽可點：`src/app/(tabs)/page.tsx`、`me/page.tsx`、`stats/page.tsx`、`manage/page.tsx` 各回傳 `<h1 className="text-3xl font-black">場次</h1>` 等標題（後續 Task 覆蓋）。

- [ ] **Step 5: 驗證與 commit**

Run: `npm run dev` → 未登入開 `/` 導到 `/login`；假登入後看到頂部列與底部四分頁可切換。`npm run lint` 無錯。
```bash
git add -A && git commit -m "feat(ui): app 外殼、底部分頁、共用元件、讀取查詢"
```

---

### Task 7: 場次列表、開場表單、場地新增

**Files:**
- Create: `src/lib/actions/events.ts`, `src/lib/actions/venues.ts`, `src/components/EventForm.tsx`, `src/components/BottomSheet.tsx`
- Modify: `src/app/(tabs)/page.tsx`

**Interfaces:**
- Produces:
  - `eventInputSchema`（zod）：`{ title, event_date, start_time, end_time, registration_deadline, venue_id, capacity, estimated_total?, note? }`
  - `createEvent(input: EventInput): Promise<{ id: string }>`：建立 + 自動報名開場者（呼叫 `register_for_event`）
  - `updateEvent(id, input)`（organizer/admin；capacity 變更走 `set_event_capacity`）
  - `cancelEvent(id)`（organizer/admin；settled 不可）
  - `createVenue(name: string, address?: string): Promise<Venue>`
  - `<EventForm venues initial? onSubmit mode="create"|"edit" />`（client）

- [ ] **Step 1: 動作與 schema**

`src/lib/actions/events.ts`:
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/db/admin";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { taipeiISO } from "@/lib/time";

export const eventInputSchema = z.object({
  title: z.string().trim().min(1, "請填場次名稱").max(60),
  event_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  registration_deadline: z.string().min(1),   // "YYYY-MM-DDTHH:mm"（台北）
  venue_id: z.string().uuid("請選地點"),
  capacity: z.coerce.number().int().min(1).max(100),
  estimated_total: z.coerce.number().int().min(0).optional().or(z.literal("").transform(() => undefined)),
  note: z.string().trim().max(500).optional(),
}).refine((v) => v.end_time > v.start_time, { message: "結束時間必須晚於開始時間", path: ["end_time"] })
  .refine((v) => new Date(`${v.registration_deadline}:00+08:00`) < new Date(taipeiISO(v.event_date, v.start_time)), { message: "結束報名時間必須早於活動開始", path: ["registration_deadline"] });
export type EventInput = z.infer<typeof eventInputSchema>;

function toRow(v: EventInput) {
  return { title: v.title, event_date: v.event_date, start_time: v.start_time, end_time: v.end_time,
    registration_deadline: `${v.registration_deadline}:00+08:00`, venue_id: v.venue_id, capacity: v.capacity,
    estimated_total: v.estimated_total ?? null, note: v.note || null };
}

export async function createEvent(raw: unknown): Promise<{ id: string }> {
  const me = await requireMember();
  const v = eventInputSchema.parse(raw);
  const sb = admin();
  const { data, error } = await sb.from("events").insert({ ...toRow(v), organizer_id: me.id }).select("id").single();
  if (error) throw new Error(error.message);
  const r = await sb.rpc("register_for_event", { p_event_id: data.id, p_member_id: me.id, p_actor_id: me.id });
  if (r.error) throw new Error(r.error.message);
  revalidatePath("/");
  return { id: data.id };
}

async function requireOrganizerOrAdmin(eventId: string) {
  const me = await requireMember();
  const { data } = await admin().from("events").select("organizer_id,status,capacity").eq("id", eventId).single();
  if (!data) throw new Error("場次不存在");
  if (data.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");
  return { me, event: data };
}

export async function updateEvent(eventId: string, raw: unknown): Promise<void> {
  const { event } = await requireOrganizerOrAdmin(eventId);
  const v = eventInputSchema.parse(raw);
  const sb = admin();
  const { capacity, ...rest } = toRow(v);
  const { error } = await sb.from("events").update(rest).eq("id", eventId);
  if (error) throw new Error(error.message);
  if (capacity !== event.capacity) {
    const r = await sb.rpc("set_event_capacity", { p_event_id: eventId, p_capacity: capacity });
    if (r.error) throw new Error(r.error.message);
  }
  revalidatePath("/"); revalidatePath(`/events/${eventId}`); revalidatePath(`/manage/${eventId}`);
}

export async function cancelEvent(eventId: string): Promise<void> {
  const { event } = await requireOrganizerOrAdmin(eventId);
  if (event.status === "settled") throw new Error("已結算的場次不可取消");
  const { error } = await admin().from("events").update({ status: "cancelled" }).eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/"); revalidatePath("/manage");
}
```

`src/lib/actions/venues.ts`:
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/db/admin";
import { requireMember, requireAdmin } from "@/lib/auth/current-member";
import type { Venue } from "@/lib/db/types";

export async function createVenue(name: string, address?: string): Promise<Venue> {
  const me = await requireMember();
  const v = z.object({ name: z.string().trim().min(1).max(60), address: z.string().trim().max(200).optional() }).parse({ name, address });
  const { data, error } = await admin().from("venues").insert({ name: v.name, address: v.address || null, created_by: me.id }).select("*").single();
  if (error) throw new Error(error.message);
  revalidatePath("/manage/venues");
  return data as Venue;
}

export async function updateVenue(id: string, patch: { name?: string; address?: string | null; is_active?: boolean }): Promise<void> {
  await requireAdmin();
  const v = z.object({ name: z.string().trim().min(1).max(60).optional(), address: z.string().trim().max(200).nullable().optional(), is_active: z.boolean().optional() }).parse(patch);
  const { error } = await admin().from("venues").update(v).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/manage/venues");
}
```

- [ ] **Step 2: BottomSheet 與 EventForm**

`src/components/BottomSheet.tsx`:
```tsx
"use client";
export default function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-[#eef1f6] p-5 pb-8" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-300" />
        <h2 className="mb-4 text-2xl font-black">{title}</h2>
        {children}
      </div>
    </div>
  );
}
```

`src/components/EventForm.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import type { Venue } from "@/lib/db/types";
import type { EventInput } from "@/lib/actions/events";
import { createVenue } from "@/lib/actions/venues";
import { defaultDeadline, hm } from "@/lib/time";

type Props = {
  venues: Venue[];
  initial?: Partial<EventInput>;
  submitLabel: string;
  onSubmit: (input: EventInput) => Promise<void>;
};

const field = "w-full rounded-2xl border-0 bg-white px-4 py-3 text-base shadow-sm";
const label = "mb-1 block text-sm font-bold text-gray-700";

export default function EventForm({ venues: initialVenues, initial, submitLabel, onSubmit }: Props) {
  const [venues, setVenues] = useState(initialVenues);
  const [f, setF] = useState<EventInput>({
    title: initial?.title ?? "", event_date: initial?.event_date ?? "", start_time: initial?.start_time ?? "19:00", end_time: initial?.end_time ?? "21:00",
    registration_deadline: initial?.registration_deadline ?? "", venue_id: initial?.venue_id ?? (initialVenues[0]?.id ?? ""),
    capacity: initial?.capacity ?? 8, estimated_total: initial?.estimated_total, note: initial?.note ?? "",
  });
  const [deadlineTouched, setDeadlineTouched] = useState(!!initial?.registration_deadline);
  const [err, setErr] = useState(""); const [pending, start] = useTransition();
  const [newVenue, setNewVenue] = useState("");

  const set = <K extends keyof EventInput>(k: K, v: EventInput[K]) => {
    const next = { ...f, [k]: v };
    if (!deadlineTouched && next.event_date && next.start_time) next.registration_deadline = defaultDeadline(next.event_date, next.start_time).slice(0, 16);
    setF(next);
  };
  const perPerson = f.estimated_total && f.capacity ? Math.ceil(Number(f.estimated_total) / f.capacity) : null;

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setErr(""); start(async () => { try { await onSubmit({ ...f, start_time: hm(f.start_time), end_time: hm(f.end_time) }); } catch (x) { setErr((x as Error).message); } }); }}>
      <div><label className={label}>場次名稱</label><input className={field} required value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="例：週三晚間歡樂場" /></div>
      <div><label className={label}>日期</label><input className={field} type="date" required value={f.event_date} onChange={(e) => set("event_date", e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={label}>開始時間</label><input className={field} type="time" required value={f.start_time} onChange={(e) => set("start_time", e.target.value)} /></div>
        <div><label className={label}>結束時間</label><input className={field} type="time" required value={f.end_time} onChange={(e) => set("end_time", e.target.value)} /></div>
      </div>
      <div>
        <label className={label}>結束報名時間</label>
        <input className={field} type="datetime-local" required value={f.registration_deadline} onChange={(e) => { setDeadlineTouched(true); setF({ ...f, registration_deadline: e.target.value }); }} />
        <p className="mt-1 text-xs text-gray-400">預設為活動前一天，超過就不能再接龍。可自行調整。</p>
      </div>
      <div>
        <label className={label}>地點</label>
        <select className={field} required value={f.venue_id} onChange={(e) => set("venue_id", e.target.value)}>
          <option value="">請選擇</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <div className="mt-2 flex gap-2">
          <input className={field} placeholder="新增地點名稱" value={newVenue} onChange={(e) => setNewVenue(e.target.value)} />
          <button type="button" className="shrink-0 rounded-2xl bg-gray-800 px-4 text-white" disabled={!newVenue.trim()} onClick={async () => { const v = await createVenue(newVenue.trim()); setVenues([...venues, v]); set("venue_id", v.id); setNewVenue(""); }}>新增</button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={label}>名額上限</label><input className={field} type="number" min={1} required value={f.capacity} onChange={(e) => set("capacity", Number(e.target.value))} /></div>
        <div><label className={label}>預計總金額</label><input className={field} type="number" min={0} placeholder="選填" value={f.estimated_total ?? ""} onChange={(e) => set("estimated_total", e.target.value === "" ? undefined : Number(e.target.value))} /></div>
      </div>
      <p className="text-xs text-gray-400">{perPerson ? `預估每人約 $${perPerson}；` : "填了會顯示「預估每人」；"}實際人數確定後再結算鎖定。</p>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button disabled={pending} className="w-full rounded-2xl bg-blue-600 py-4 text-lg font-bold text-white disabled:opacity-50">{pending ? "處理中…" : submitLabel}</button>
    </form>
  );
}
```

- [ ] **Step 3: 場次列表頁**

`src/app/(tabs)/page.tsx`:
```tsx
import EventCard from "@/components/EventCard";
import CreateEventButton from "@/components/CreateEventButton";
import { listEvents, listActiveVenues } from "@/lib/db/queries";
import { isPast } from "@/lib/domain/event-status";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  const now = new Date();
  const [events, venues] = await Promise.all([listEvents(), listActiveVenues()]);
  const upcoming = events.filter((e) => !isPast(e, now));
  const past = events.filter((e) => isPast(e, now)).reverse();
  const pastUnpaid = past.filter((e) => e.status === "open" || e.status === "settled").length;
  return (
    <div className="space-y-4">
      <div><h1 className="text-3xl font-black">活動場次</h1><p className="text-gray-500">接龍 +1，名額滿了自動排候補</p></div>
      {upcoming.length === 0 && <p className="py-10 text-center text-gray-400">目前沒有即將舉行的場次</p>}
      {upcoming.map((e) => <EventCard key={e.id} event={e} href={`/events/${e.id}`} now={now} />)}
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer py-2 font-bold text-gray-500">已結束 · 待處理 {pastUnpaid}</summary>
          <div className="space-y-4 pt-2">{past.map((e) => <EventCard key={e.id} event={e} href={`/events/${e.id}`} now={now} />)}</div>
        </details>
      )}
      <CreateEventButton venues={venues} />
    </div>
  );
}
```

`src/components/CreateEventButton.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import BottomSheet from "./BottomSheet";
import EventForm from "./EventForm";
import { createEvent } from "@/lib/actions/events";
import type { Venue } from "@/lib/db/types";

export default function CreateEventButton({ venues }: { venues: Venue[] }) {
  const [open, setOpen] = useState(false); const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="fixed bottom-24 right-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg" aria-label="開場"><Plus size={28} /></button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="開新場次">
        <EventForm venues={venues} submitLabel="開場（自動 +1 接龍）" onSubmit={async (input) => { const { id } = await createEvent(input); setOpen(false); router.push(`/events/${id}`); }} />
      </BottomSheet>
    </>
  );
}
```

- [ ] **Step 4: 手動驗證**

假登入 → 首頁 + → 填表（新增一個地點）→ 開場 → 導到詳情頁（Task 8 前會 404，先回首頁確認卡片出現、1/8）。用 Supabase Table Editor 確認 events 與 registrations 各一筆。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(events): 場次列表、開場表單、場地新增、場次編輯與取消動作"
```

---
### Task 8: 場次詳情、接龍／取消、分享

**Files:**
- Create: `src/lib/actions/registrations.ts`, `src/app/events/[id]/page.tsx`, `src/components/RegisterButton.tsx`, `src/components/ShareButton.tsx`, `src/components/RosterList.tsx`

**Interfaces:**
- Produces:
  - `register(eventId)`、`cancel(eventId)`：本人操作，走 `register_for_event` / `cancel_registration`
  - `organizerAdd(eventId, memberId)`、`organizerRemove(eventId, memberId)`：organizer/admin 代加代刪（actor 為自己）
  - `<RosterList registrations />`、`<RegisterButton eventId mine status />`、`<ShareButton event url />`

- [ ] **Step 1: registrations 動作**

`src/lib/actions/registrations.ts`:
```ts
"use server";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/db/admin";
import { requireMember, isAdmin } from "@/lib/auth/current-member";

function bust(eventId: string) { revalidatePath("/"); revalidatePath("/me"); revalidatePath(`/events/${eventId}`); revalidatePath(`/manage/${eventId}`); }

export async function register(eventId: string): Promise<void> {
  const me = await requireMember();
  const r = await admin().rpc("register_for_event", { p_event_id: eventId, p_member_id: me.id, p_actor_id: me.id });
  if (r.error) throw new Error(r.error.message);
  bust(eventId);
}

export async function cancel(eventId: string): Promise<void> {
  const me = await requireMember();
  const r = await admin().rpc("cancel_registration", { p_event_id: eventId, p_member_id: me.id, p_actor_id: me.id });
  if (r.error) throw new Error(r.error.message);
  bust(eventId);
}

async function assertOrganizer(eventId: string) {
  const me = await requireMember();
  const { data } = await admin().from("events").select("organizer_id").eq("id", eventId).single();
  if (!data) throw new Error("場次不存在");
  if (data.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");
  return me;
}

export async function organizerAdd(eventId: string, memberId: string): Promise<void> {
  const me = await assertOrganizer(eventId);
  const r = await admin().rpc("register_for_event", { p_event_id: eventId, p_member_id: memberId, p_actor_id: me.id });
  if (r.error) throw new Error(r.error.message);
  bust(eventId);
}

export async function organizerRemove(eventId: string, memberId: string): Promise<void> {
  const me = await assertOrganizer(eventId);
  const r = await admin().rpc("cancel_registration", { p_event_id: eventId, p_member_id: memberId, p_actor_id: me.id });
  if (r.error) throw new Error(r.error.message);
  bust(eventId);
}
```

- [ ] **Step 2: 元件**

`src/components/RosterList.tsx`:
```tsx
import Avatar from "./Avatar";
import type { RegistrationWithMember } from "@/lib/db/queries";

export default function RosterList({ registrations, organizerId }: { registrations: RegistrationWithMember[]; organizerId: string }) {
  const confirmed = registrations.filter((r) => r.status === "confirmed");
  const waitlisted = registrations.filter((r) => r.status === "waitlisted");
  const Row = ({ r, tag }: { r: RegistrationWithMember; tag?: string }) => (
    <li className="flex items-center gap-3 py-2">
      <Avatar src={r.member.picture_url} name={r.member.display_name} />
      <span className="flex-1 font-semibold">{r.member.display_name}</span>
      {r.member.id === organizerId && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">開場者</span>}
      {tag && <span className="text-xs text-orange-500">{tag}</span>}
    </li>
  );
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="font-bold text-gray-500">正取 {confirmed.length}</h3>
      <ul className="divide-y">{confirmed.map((r) => <Row key={r.id} r={r} />)}</ul>
      {waitlisted.length > 0 && (<>
        <h3 className="mt-3 font-bold text-gray-500">候補 {waitlisted.length}</h3>
        <ul className="divide-y">{waitlisted.map((r) => <Row key={r.id} r={r} tag={`候補 ${r.waitlist_position}`} />)}</ul>
      </>)}
    </div>
  );
}
```

`src/components/RegisterButton.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { register, cancel } from "@/lib/actions/registrations";
import type { DisplayStatus } from "@/lib/domain/event-status";

type Props = { eventId: string; mine: "confirmed" | "waitlisted" | null; status: DisplayStatus; full: boolean };

export default function RegisterButton({ eventId, mine, status, full }: Props) {
  const [err, setErr] = useState(""); const [pending, start] = useTransition();
  if (status !== "接龍中") return <button disabled className="w-full rounded-2xl bg-gray-300 py-4 text-lg font-bold text-white">{status}</button>;
  const label = mine ? (mine === "confirmed" ? "取消接龍" : "取消候補") : full ? "已額滿，排候補 +1" : "接龍 +1";
  const cls = mine ? "bg-white text-red-600 border border-red-200" : "bg-blue-600 text-white";
  return (
    <div>
      <button disabled={pending} className={`w-full rounded-2xl py-4 text-lg font-bold disabled:opacity-50 ${cls}`}
        onClick={() => { setErr(""); start(async () => { try { await (mine ? cancel(eventId) : register(eventId)); } catch (e) { setErr((e as Error).message); } }); }}>
        {pending ? "處理中…" : label}
      </button>
      {err && <p className="mt-2 text-center text-sm text-red-600">{err}</p>}
    </div>
  );
}
```

`src/components/ShareButton.tsx`:
```tsx
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
```

- [ ] **Step 3: 詳情頁**

`src/app/events/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, MapPin, Users } from "lucide-react";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { getEvent, listRegistrations } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import { dateParts, formatTaipei, hm } from "@/lib/time";
import StatusBadge from "@/components/StatusBadge";
import CapacityBar from "@/components/CapacityBar";
import RosterList from "@/components/RosterList";
import RegisterButton from "@/components/RegisterButton";
import ShareButton from "@/components/ShareButton";

export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMember();
  const [event, regs] = await Promise.all([getEvent(id), listRegistrations(id)]);
  if (!event) notFound();
  const now = new Date();
  const status = deriveEventStatus(event, now);
  const mine = regs.find((r) => r.member_id === me.id) ?? null;
  const d = dateParts(event.event_date);
  const canManage = event.organizer_id === me.id || isAdmin(me);
  const perPerson = event.estimated_total && event.capacity ? Math.ceil(event.estimated_total / event.capacity) : null;
  return (
    <div className="space-y-4 px-4 pb-10 pt-4">
      <div className="flex items-center justify-between">
        <Link href="/" className="flex items-center gap-1 text-gray-500"><ArrowLeft size={18} />場次</Link>
        <div className="flex gap-2">
          <ShareButton title={event.title} text={`${event.event_date}（${d.weekday}）${hm(event.start_time)}–${hm(event.end_time)} @ ${event.venue.name}`} path={`/events/${event.id}`} />
          {canManage && <Link href={`/manage/${event.id}`} className="rounded-full border bg-white px-3 py-1.5 text-sm font-semibold">管理</Link>}
        </div>
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-2"><h1 className="text-2xl font-black">{event.title}</h1><StatusBadge status={status} /></div>
        <p className="mt-2 flex items-center gap-2 text-gray-600"><Clock size={16} />{event.event_date}（{d.weekday}）{hm(event.start_time)}–{hm(event.end_time)}</p>
        <p className="flex items-center gap-2 text-gray-600"><MapPin size={16} />{event.venue.name}{event.venue.address ? `・${event.venue.address}` : ""}</p>
        <p className="flex items-center gap-2 text-gray-600"><Users size={16} />開場者：{event.organizer.display_name}</p>
        <p className="mt-1 text-sm text-gray-400">結束報名：{formatTaipei(event.registration_deadline)}</p>
        {event.note && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{event.note}</p>}
        <div className="mt-4"><CapacityBar confirmed={event.confirmed_count} capacity={event.capacity} waitlist={event.waitlist_count} /></div>
        {event.status === "settled" ? (
          <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm">
            <p>實際總金額 ${event.final_total}，每人 ${regs.find((r) => r.attended)?.amount_due ?? 0}</p>
            {mine && <p className="mt-1 font-bold">{mine.attended ? (mine.paid_at ? `你已付 $${mine.paid_amount}` : `你待付 $${mine.amount_due}`) : "你未出席，不需付款"}</p>}
          </div>
        ) : perPerson ? <p className="mt-3 text-sm text-gray-500">預計總金額 ${event.estimated_total}，預估每人約 ${perPerson}</p> : null}
      </div>
      <RegisterButton eventId={event.id} mine={mine?.status ?? null} status={status} full={event.confirmed_count >= event.capacity} />
      <RosterList registrations={regs} organizerId={event.organizer_id} />
    </div>
  );
}
```

- [ ] **Step 4: 手動驗證**

以兩個假帳號（不同 name）輪流：接龍到額滿、第三人排候補、正取取消後候補遞補、卡片與詳情計數正確；改 registration_deadline 為過去時間後按鈕變「已截止」。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(events): 場次詳情、接龍與取消、名單、分享"
```

---

### Task 9: 我的頁面

**Files:**
- Modify: `src/app/(tabs)/me/page.tsx`

**Interfaces:**
- Consumes: `listMyRegistrations(memberId)`、`isPast`、`deriveEventStatus`

- [ ] **Step 1: 實作頁面**

```tsx
import Link from "next/link";
import { requireMember } from "@/lib/auth/current-member";
import { listMyRegistrations } from "@/lib/db/queries";
import { isPast } from "@/lib/domain/event-status";
import { dateParts, hm } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const me = await requireMember();
  const now = new Date();
  const regs = (await listMyRegistrations(me.id)).filter((r) => r.event.status !== "cancelled");
  const unpaid = regs.filter((r) => r.event.status === "settled" && r.attended && !r.paid_at);
  const total = unpaid.reduce((s, r) => s + (r.amount_due ?? 0), 0);
  const upcoming = regs.filter((r) => !isPast(r.event, now)).sort((a, b) => a.event.event_date.localeCompare(b.event.event_date));
  const history = regs.filter((r) => isPast(r.event, now)).sort((a, b) => b.event.event_date.localeCompare(a.event.event_date));

  const Row = ({ r, right }: { r: (typeof regs)[number]; right: React.ReactNode }) => {
    const d = dateParts(r.event.event_date);
    return (
      <Link href={`/events/${r.event.id}`} className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm">
        <div className="flex w-14 flex-col items-center rounded-xl bg-gray-100 py-1"><span className="text-xl font-black">{d.day}</span><span className="text-xs text-gray-500">{d.weekday}</span></div>
        <div className="min-w-0 flex-1"><p className="truncate font-bold">{r.event.title}</p><p className="text-sm text-gray-500">{hm(r.event.start_time)} · {r.event.venue.name}</p></div>
        {right}
      </Link>
    );
  };
  const badge = (cls: string, t: string) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cls}`}>{t}</span>;

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-black">參與場次</h1>
      <div className="rounded-3xl bg-gradient-to-br from-blue-600 to-blue-800 p-5 text-white">
        <p className="text-sm">待付款金額</p>
        <p className="text-4xl font-black">${total}</p>
        <p className="mt-1 text-sm">{total === 0 ? "太棒了，目前沒有任何欠款" : `${unpaid.length} 場待付`}</p>
      </div>
      <section><h2 className="mb-2 font-bold text-gray-500">即將參加 {upcoming.length}</h2>
        <div className="space-y-3">{upcoming.map((r) => <Row key={r.id} r={r} right={r.status === "waitlisted" ? badge("bg-orange-50 text-orange-600", `候補 ${r.waitlist_position}`) : badge("bg-green-50 text-green-700", "正取")} />)}
          {upcoming.length === 0 && <p className="py-6 text-center text-gray-400">還沒接龍任何場次，去「場次」找一場吧</p>}</div></section>
      <section><h2 className="mb-2 font-bold text-gray-500">歷史紀錄 {history.length}</h2>
        <div className="space-y-3">{history.map((r) => {
          const right = r.event.status !== "settled" ? badge("bg-gray-100 text-gray-500", "待結算")
            : !r.attended ? badge("bg-gray-100 text-gray-500", "未出席")
            : r.paid_at ? badge("bg-green-50 text-green-700", `已付 $${r.paid_amount}`) : badge("bg-red-50 text-red-600", `待付 $${r.amount_due}`);
          return <Row key={r.id} r={r} right={right} />; })}</div></section>
    </div>
  );
}
```

- [ ] **Step 2: 驗證與 commit**

假登入成員接龍過的場次出現在即將參加；用 SQL 把某場改 settled 並填 attended/amount_due 後，待付款金額正確。
```bash
git add -A && git commit -m "feat(me): 我的頁面：待付款、即將參加、歷史紀錄"
```

---

### Task 10: 統計頁

**Files:**
- Modify: `src/app/(tabs)/stats/page.tsx`
- Create: `src/components/Leaderboard.tsx`

**Interfaces:**
- Consumes: `listAttendanceRows`、`listEvents`、`listMembers`、`sumPaid`、`computeAttendance`、`buildLeaderboard`、`isPast`
- 查詢參數 `?range=all` 切換全部期間，預設本年度（以 event_date 年份 = 台北今年）

- [ ] **Step 1: Leaderboard 元件**

```tsx
import Avatar from "./Avatar";
import type { LeaderboardEntry } from "@/lib/domain/stats";

export default function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const [first, second, third] = entries;
  const podium = [{ e: second, h: "h-20", c: "bg-gray-300" }, { e: first, h: "h-28", c: "bg-yellow-400" }, { e: third, h: "h-16", c: "bg-amber-600" }];
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-around rounded-2xl bg-white px-2 pt-4 shadow-sm">
        {podium.map(({ e, h, c }, i) => e ? (
          <div key={e.member.id} className="flex w-1/3 flex-col items-center">
            {i === 1 && <span className="text-yellow-500">👑</span>}
            <Avatar src={e.member.picture_url} name={e.member.display_name} size={56} />
            <p className="mt-1 max-w-full truncate text-sm font-bold">{e.member.display_name}</p>
            <p className="text-xs text-gray-500">{e.count} 場</p>
            <div className={`mt-2 w-full rounded-t-2xl ${c} ${h} flex items-start justify-center pt-2 text-2xl font-black text-white`}>{e.rank}</div>
          </div>
        ) : <div key={i} className="w-1/3" />)}
      </div>
      <ol className="divide-y rounded-2xl bg-white px-4 shadow-sm">
        {entries.slice(3).map((e) => (
          <li key={e.member.id} className="flex items-center gap-3 py-3">
            <span className="w-7 rounded-lg bg-gray-100 py-1 text-center text-sm font-bold">{e.rank}</span>
            <div className="flex-1"><p className="font-bold">{e.member.display_name}</p>
              <div className="mt-1 h-1.5 rounded-full bg-gray-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.round((e.count / entries[0].count) * 100)}%` }} /></div></div>
            <span className="font-bold text-blue-600">{e.count} 場</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: 統計頁**

```tsx
import Link from "next/link";
import { requireMember } from "@/lib/auth/current-member";
import { listAttendanceRows, listEvents, listMembers, sumPaid } from "@/lib/db/queries";
import { computeAttendance, buildLeaderboard } from "@/lib/domain/stats";
import { isPast } from "@/lib/domain/event-status";
import { taipeiDateString } from "@/lib/time";
import Leaderboard from "@/components/Leaderboard";

export const dynamic = "force-dynamic";

export default async function StatsPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const me = await requireMember();
  const { range } = await searchParams;
  const now = new Date();
  const year = taipeiDateString(now).slice(0, 4);
  const inRange = (date: string) => range === "all" || date.startsWith(year);
  const [rowsAll, events, members, paid] = await Promise.all([listAttendanceRows(), listEvents(), listMembers(), sumPaid()]);
  const rows = rowsAll.filter((r) => inRange(r.event_date));
  const counts = computeAttendance(rows, now);
  const lb = buildLeaderboard(counts, members);
  const totalEvents = events.filter((e) => inRange(e.event_date) && isPast(e, now)).length;
  const totalAttend = [...counts.values()].reduce((a, b) => a + b, 0);
  const Card = ({ n, label }: { n: string | number; label: string }) => (
    <div className="rounded-2xl bg-white p-4 shadow-sm"><p className="text-3xl font-black">{n}</p><p className="text-sm text-gray-500">{label}</p></div>
  );
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div><h1 className="text-3xl font-black">球隊統計</h1><p className="text-gray-500">{range === "all" ? "全部期間" : `${year} 年`}</p></div>
        <Link href={range === "all" ? "/stats" : "/stats?range=all"} className="rounded-full border bg-white px-3 py-1 text-sm">{range === "all" ? "看本年度" : "看全部"}</Link>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card n={totalEvents} label="總場次" /><Card n={totalAttend} label="總出席人次" />
        <Card n={counts.get(me.id) ?? 0} label="我的出席場數" /><Card n={`$${paid}`} label="已收款金額" />
      </div>
      <h2 className="font-bold text-gray-500">出席排行榜</h2>
      {lb.length === 0 ? <p className="py-6 text-center text-gray-400">還沒有出席紀錄</p> : <Leaderboard entries={lb} />}
    </div>
  );
}
```

- [ ] **Step 3: 驗證與 commit**

用 SQL 造幾筆過去場次與出席，排行榜順序與四張卡數字符合 4.7 規則。
```bash
git add -A && git commit -m "feat(stats): 統計卡片與出席排行榜"
```

---
### Task 11: 管理列表、單場管理（編輯、名單代加代刪、取消）

**Files:**
- Modify: `src/app/(tabs)/manage/page.tsx`
- Create: `src/app/(tabs)/manage/[id]/page.tsx`, `src/components/manage/EditEventSection.tsx`, `src/components/manage/RosterManager.tsx`, `src/components/manage/CancelEventButton.tsx`

**Interfaces:**
- Consumes: `listEventsByOrganizer`、`getEvent`、`listRegistrations`、`listMembers`、`listActiveVenues`、`updateEvent`、`cancelEvent`、`organizerAdd`、`organizerRemove`、`EventForm`
- Produces: 單場管理頁在 Task 12 追加結算與收款區塊

- [ ] **Step 1: 管理列表**

`src/app/(tabs)/manage/page.tsx`:
```tsx
import Link from "next/link";
import EventCard from "@/components/EventCard";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { listEventsByOrganizer } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const me = await requireMember();
  const { all } = await searchParams;
  const showAll = isAdmin(me) && all === "1";
  const events = await listEventsByOrganizer(showAll ? null : me.id);
  const now = new Date();
  return (
    <div className="space-y-4">
      <div><h1 className="text-3xl font-black">場次管理</h1><p className="text-gray-500">編輯場次、結算分帳、收款</p></div>
      {isAdmin(me) && (
        <div className="flex gap-2 text-sm">
          <Link href="/manage" className={`rounded-full px-3 py-1 ${!showAll ? "bg-blue-600 text-white" : "bg-white"}`}>我開的</Link>
          <Link href="/manage?all=1" className={`rounded-full px-3 py-1 ${showAll ? "bg-blue-600 text-white" : "bg-white"}`}>全部場次</Link>
          <Link href="/manage/venues" className="ml-auto rounded-full bg-white px-3 py-1">場地維護</Link>
        </div>
      )}
      {events.length === 0 && <p className="py-16 text-center text-gray-400">還沒有你開的場次<br />到「場次」按右下角 + 開一場</p>}
      {events.map((e) => <EventCard key={e.id} event={e} href={`/manage/${e.id}`} now={now} />)}
    </div>
  );
}
```

- [ ] **Step 2: 編輯區塊、名單管理、取消按鈕**

`src/components/manage/EditEventSection.tsx`:
```tsx
"use client";
import { useState } from "react";
import BottomSheet from "@/components/BottomSheet";
import EventForm from "@/components/EventForm";
import { updateEvent, type EventInput } from "@/lib/actions/events";
import type { Venue } from "@/lib/db/types";

export default function EditEventSection({ eventId, venues, initial }: { eventId: string; venues: Venue[]; initial: EventInput }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="w-full rounded-2xl bg-white py-3 font-bold shadow-sm">編輯場次資訊</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="編輯場次">
        <EventForm venues={venues} initial={initial} submitLabel="儲存" onSubmit={async (i) => { await updateEvent(eventId, i); setOpen(false); }} />
      </BottomSheet>
    </>
  );
}
```

`src/components/manage/RosterManager.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import { organizerAdd, organizerRemove } from "@/lib/actions/registrations";
import type { RegistrationWithMember, MemberLite } from "@/lib/db/queries";

export default function RosterManager({ eventId, registrations, members, locked }: { eventId: string; registrations: RegistrationWithMember[]; members: MemberLite[]; locked: boolean }) {
  const [q, setQ] = useState(""); const [err, setErr] = useState(""); const [pending, start] = useTransition();
  const inEvent = new Set(registrations.map((r) => r.member_id));
  const candidates = q.trim() ? members.filter((m) => !inEvent.has(m.id) && m.display_name.includes(q.trim())).slice(0, 8) : [];
  const run = (fn: () => Promise<void>) => { setErr(""); start(async () => { try { await fn(); } catch (e) { setErr((e as Error).message); } }); };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="font-bold">名單</h3>
      <ul className="divide-y">
        {registrations.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <Avatar src={r.member.picture_url} name={r.member.display_name} size={32} />
            <span className="flex-1">{r.member.display_name}{r.status === "waitlisted" && <span className="ml-2 text-xs text-orange-500">候補 {r.waitlist_position}</span>}</span>
            {!locked && <button disabled={pending} className="text-sm text-red-600" onClick={() => run(() => organizerRemove(eventId, r.member_id))}>移除</button>}
          </li>
        ))}
      </ul>
      {!locked && (<>
        <input className="mt-3 w-full rounded-xl bg-gray-100 px-3 py-2" placeholder="搜尋成員名稱以代加" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul>{candidates.map((m) => (
          <li key={m.id} className="flex items-center gap-3 py-2"><Avatar src={m.picture_url} name={m.display_name} size={28} /><span className="flex-1">{m.display_name}</span>
            <button disabled={pending} className="text-sm text-blue-600" onClick={() => run(async () => { await organizerAdd(eventId, m.id); setQ(""); })}>加入</button></li>
        ))}</ul>
      </>)}
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
    </div>
  );
}
```

`src/components/manage/CancelEventButton.tsx`:
```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelEvent } from "@/lib/actions/events";

export default function CancelEventButton({ eventId }: { eventId: string }) {
  const [pending, start] = useTransition(); const router = useRouter();
  return (
    <button disabled={pending} className="w-full rounded-2xl border border-red-200 bg-white py-3 font-bold text-red-600"
      onClick={() => { if (confirm("確定取消這個場次？取消後不計統計。")) start(async () => { await cancelEvent(eventId); router.push("/manage"); }); }}>
      取消場次
    </button>
  );
}
```

- [ ] **Step 3: 單場管理頁（結算區塊留到 Task 12）**

`src/app/(tabs)/manage/[id]/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { getEvent, listRegistrations, listMembers, listActiveVenues } from "@/lib/db/queries";
import { deriveEventStatus } from "@/lib/domain/event-status";
import { hm, taipeiParts } from "@/lib/time";
import StatusBadge from "@/components/StatusBadge";
import EditEventSection from "@/components/manage/EditEventSection";
import RosterManager from "@/components/manage/RosterManager";
import CancelEventButton from "@/components/manage/CancelEventButton";

export const dynamic = "force-dynamic";

export default async function ManageEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMember();
  const event = await getEvent(id);
  if (!event) notFound();
  if (event.organizer_id !== me.id && !isAdmin(me)) notFound();
  const [regs, members, venues] = await Promise.all([listRegistrations(id), listMembers(), listActiveVenues()]);
  const status = deriveEventStatus(event, new Date());
  const dl = taipeiParts(new Date(event.registration_deadline));
  const initial = { title: event.title, event_date: event.event_date, start_time: hm(event.start_time), end_time: hm(event.end_time),
    registration_deadline: `${dl.date}T${dl.time}`, venue_id: event.venue_id, capacity: event.capacity, estimated_total: event.estimated_total ?? undefined, note: event.note ?? "" };
  return (
    <div className="space-y-4">
      <Link href="/manage" className="text-gray-500">← 場次管理</Link>
      <div className="flex items-start justify-between"><h1 className="text-2xl font-black">{event.title}</h1><StatusBadge status={status} /></div>
      <p className="text-gray-500">{event.event_date} {hm(event.start_time)}–{hm(event.end_time)} · {event.venue.name}</p>
      {event.status !== "cancelled" && <EditEventSection eventId={id} venues={venues} initial={initial} />}
      <RosterManager eventId={id} registrations={regs} members={members} locked={event.status !== "open"} />
      {/* Task 12：<SettlementSection /> 與 <PaymentList /> 放這裡 */}
      {event.status === "open" && <CancelEventButton eventId={id} />}
    </div>
  );
}
```

- [ ] **Step 4: 驗證與 commit**

開場者進管理頁可編輯（改名額 8→2 後多出的人變候補不會被踢，改回 8 自動遞補）、代加代刪、取消場次；非開場者訪問他人管理頁 404；管理員可看全部。
```bash
git add -A && git commit -m "feat(manage): 管理列表、場次編輯、名單代加代刪、取消場次"
```

---

### Task 12: 結算與收款紀錄

**Files:**
- Create: `src/lib/actions/settlement.ts`, `src/components/manage/SettlementSection.tsx`, `src/components/manage/PaymentList.tsx`
- Modify: `src/app/(tabs)/manage/[id]/page.tsx`（插入兩個區塊）

**Interfaces:**
- Produces:
  - `settleEvent(eventId, input: { finalTotal: number; attendedMemberIds: string[] })`：organizer/admin；走 `settle_event`
  - `markPaid(eventId, memberId)`、`unmarkPaid(eventId, memberId)`
  - `<SettlementSection event registrations />`（client；用 `computeSettlement` 即時預覽）
  - `<PaymentList eventId registrations />`（client）

- [ ] **Step 1: 動作**

`src/lib/actions/settlement.ts`:
```ts
"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { admin } from "@/lib/db/admin";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { computeSettlement } from "@/lib/domain/settlement";

async function assertOrganizer(eventId: string) {
  const me = await requireMember();
  const { data } = await admin().from("events").select("organizer_id,status").eq("id", eventId).single();
  if (!data) throw new Error("場次不存在");
  if (data.organizer_id !== me.id && !isAdmin(me)) throw new Error("沒有權限");
  return { me, event: data };
}
const bust = (id: string) => { revalidatePath(`/manage/${id}`); revalidatePath(`/events/${id}`); revalidatePath("/me"); revalidatePath("/stats"); revalidatePath("/"); };

export async function settleEvent(eventId: string, raw: unknown): Promise<void> {
  await assertOrganizer(eventId);
  const v = z.object({ finalTotal: z.coerce.number().int().min(0), attendedMemberIds: z.array(z.string().uuid()).min(1, "到場人數不可為 0") }).parse(raw);
  computeSettlement(v); // 同樣規則先在應用層驗證
  const r = await admin().rpc("settle_event", { p_event_id: eventId, p_final_total: v.finalTotal, p_attended: v.attendedMemberIds });
  if (r.error) throw new Error(r.error.message);
  bust(eventId);
}

export async function markPaid(eventId: string, memberId: string): Promise<void> {
  const { me, event } = await assertOrganizer(eventId);
  if (event.status !== "settled") throw new Error("尚未結算");
  const { data: reg } = await admin().from("registrations").select("amount_due").eq("event_id", eventId).eq("member_id", memberId).single();
  if (!reg) throw new Error("找不到報名");
  const { error } = await admin().from("registrations").update({ paid_at: new Date().toISOString(), paid_amount: reg.amount_due ?? 0, paid_marked_by: me.id }).eq("event_id", eventId).eq("member_id", memberId);
  if (error) throw new Error(error.message);
  bust(eventId);
}

export async function unmarkPaid(eventId: string, memberId: string): Promise<void> {
  await assertOrganizer(eventId);
  const { error } = await admin().from("registrations").update({ paid_at: null, paid_amount: null, paid_marked_by: null }).eq("event_id", eventId).eq("member_id", memberId);
  if (error) throw new Error(error.message);
  bust(eventId);
}
```

- [ ] **Step 2: SettlementSection**

```tsx
"use client";
import { useMemo, useState, useTransition } from "react";
import Avatar from "@/components/Avatar";
import { settleEvent } from "@/lib/actions/settlement";
import { computeSettlement } from "@/lib/domain/settlement";
import type { EventWithCounts, RegistrationWithMember } from "@/lib/db/queries";

export default function SettlementSection({ event, registrations }: { event: EventWithCounts; registrations: RegistrationWithMember[] }) {
  const settled = event.status === "settled";
  const [open, setOpen] = useState(!settled);
  const [total, setTotal] = useState<number>(event.final_total ?? event.estimated_total ?? 0);
  const [attended, setAttended] = useState<Set<string>>(() => new Set(registrations.filter((r) => settled ? r.attended : r.status === "confirmed").map((r) => r.member_id)));
  const [err, setErr] = useState(""); const [pending, start] = useTransition();
  const preview = useMemo(() => { try { return computeSettlement({ finalTotal: total, attendedMemberIds: [...attended] }); } catch (e) { return { error: (e as Error).message }; } }, [total, attended]);
  const toggle = (id: string) => { const s = new Set(attended); s.has(id) ? s.delete(id) : s.add(id); setAttended(s); };
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="font-bold">{settled ? "重新結算" : "結算"}</h3>
        {settled && <button className="text-sm text-blue-600" onClick={() => setOpen(!open)}>{open ? "收合" : "展開"}</button>}</div>
      {open && (<>
        <p className="mt-1 text-xs text-gray-500">勾選實際到場的人，輸入實際總金額，系統自動均分（無條件進位）。</p>
        <ul className="mt-2 divide-y">{registrations.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <input type="checkbox" className="h-5 w-5" checked={attended.has(r.member_id)} onChange={() => toggle(r.member_id)} />
            <Avatar src={r.member.picture_url} name={r.member.display_name} size={28} />
            <span className="flex-1">{r.member.display_name}</span>
            {r.status === "waitlisted" && <span className="text-xs text-orange-500">候補</span>}
          </li>))}</ul>
        <label className="mt-3 block text-sm font-bold">實際總金額</label>
        <input type="number" min={0} className="w-full rounded-xl bg-gray-100 px-3 py-2" value={total} onChange={(e) => setTotal(Number(e.target.value))} />
        <div className="mt-2 rounded-xl bg-blue-50 p-3 text-sm">
          {"error" in preview ? <p className="text-red-600">{preview.error}</p> : (<>
            <p>到場 {attended.size} 人，每人 <b>${preview.perPerson}</b></p>
            <p className="text-gray-500">應收合計 ${preview.expectedIncome}，與實際總金額差 ${preview.diff}</p></>)}
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <button disabled={pending || "error" in preview} className="mt-3 w-full rounded-2xl bg-blue-600 py-3 font-bold text-white disabled:opacity-50"
          onClick={() => { setErr(""); start(async () => { try { await settleEvent(event.id, { finalTotal: total, attendedMemberIds: [...attended] }); setOpen(false); } catch (e) { setErr((e as Error).message); } }); }}>
          {settled ? "更新結算" : "確認結算"}
        </button>
      </>)}
    </div>
  );
}
```

- [ ] **Step 3: PaymentList**

```tsx
"use client";
import { useTransition } from "react";
import Avatar from "@/components/Avatar";
import { markPaid, unmarkPaid } from "@/lib/actions/settlement";
import type { RegistrationWithMember } from "@/lib/db/queries";
import { formatTaipei } from "@/lib/time";

export default function PaymentList({ eventId, registrations }: { eventId: string; registrations: RegistrationWithMember[] }) {
  const [pending, start] = useTransition();
  const rows = registrations.filter((r) => r.attended);
  const collected = rows.reduce((s, r) => s + (r.paid_at ? r.paid_amount ?? 0 : 0), 0);
  const due = rows.reduce((s, r) => s + (r.amount_due ?? 0), 0);
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between"><h3 className="font-bold">收款紀錄</h3><span className="text-sm text-gray-500">已收 ${collected} / 應收 ${due}</span></div>
      <ul className="divide-y">{rows.map((r) => {
        const mismatch = r.paid_at && r.paid_amount !== r.amount_due;
        return (
          <li key={r.id} className="flex items-center gap-3 py-2">
            <Avatar src={r.member.picture_url} name={r.member.display_name} size={28} />
            <div className="flex-1"><p>{r.member.display_name} <span className="text-sm text-gray-500">${r.amount_due}</span></p>
              {r.paid_at && <p className="text-xs text-gray-400">已付 ${r.paid_amount} · {formatTaipei(r.paid_at)}</p>}
              {mismatch && <p className="text-xs font-bold text-red-600">已付金額與應付不符</p>}</div>
            <button disabled={pending} className={`rounded-full px-3 py-1 text-sm font-bold ${r.paid_at ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-600"}`}
              onClick={() => start(() => (r.paid_at ? unmarkPaid(eventId, r.member_id) : markPaid(eventId, r.member_id)))}>{r.paid_at ? "已付" : "標記已付"}</button>
          </li>);
      })}</ul>
    </div>
  );
}
```

- [ ] **Step 4: 插入管理頁**

在 `manage/[id]/page.tsx` 的 Task 11 註解處替換為：
```tsx
{event.status !== "cancelled" && <SettlementSection event={event} registrations={regs} />}
{event.status === "settled" && <PaymentList eventId={id} registrations={regs} />}
```
並 import 兩個元件。

- [ ] **Step 5: 驗證與 commit**

結算 3 人 1000 元 → 每人 334、差額 2；標記兩人已付 → 「我的」待付款只剩一人；重新結算改成 2 人 → 已付者出現「不符」警示、詳情頁每人金額更新、統計出席數更新。
```bash
git add -A && git commit -m "feat(settlement): 結算與重算、收款標記、不符警示"
```

---

### Task 13: 場地維護（admin）

**Files:**
- Create: `src/app/(tabs)/manage/venues/page.tsx`, `src/components/manage/VenueEditor.tsx`

- [ ] **Step 1: 頁面與元件**

`src/app/(tabs)/manage/venues/page.tsx`:
```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMember, isAdmin } from "@/lib/auth/current-member";
import { listAllVenues } from "@/lib/db/queries";
import VenueEditor from "@/components/manage/VenueEditor";

export const dynamic = "force-dynamic";

export default async function VenuesPage() {
  const me = await requireMember();
  if (!isAdmin(me)) notFound();
  const venues = await listAllVenues();
  return (
    <div className="space-y-4">
      <Link href="/manage" className="text-gray-500">← 場次管理</Link>
      <h1 className="text-3xl font-black">場地維護</h1>
      <VenueEditor venues={venues} />
    </div>
  );
}
```

`src/components/manage/VenueEditor.tsx`:
```tsx
"use client";
import { useState, useTransition } from "react";
import { createVenue, updateVenue } from "@/lib/actions/venues";
import type { Venue } from "@/lib/db/types";

export default function VenueEditor({ venues }: { venues: Venue[] }) {
  const [name, setName] = useState(""); const [address, setAddress] = useState(""); const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="font-bold">新增場地</h3>
        <input className="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2" placeholder="名稱" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="mt-2 w-full rounded-xl bg-gray-100 px-3 py-2" placeholder="地址（選填）" value={address} onChange={(e) => setAddress(e.target.value)} />
        <button disabled={pending || !name.trim()} className="mt-2 w-full rounded-xl bg-blue-600 py-2 font-bold text-white disabled:opacity-50"
          onClick={() => start(async () => { await createVenue(name.trim(), address.trim() || undefined); setName(""); setAddress(""); })}>新增</button>
      </div>
      <ul className="divide-y rounded-2xl bg-white px-4 shadow-sm">{venues.map((v) => (
        <li key={v.id} className="flex items-center gap-3 py-3">
          <div className="flex-1"><p className={`font-bold ${v.is_active ? "" : "text-gray-400 line-through"}`}>{v.name}</p>{v.address && <p className="text-xs text-gray-500">{v.address}</p>}</div>
          <button disabled={pending} className="text-sm text-blue-600" onClick={() => { const n = prompt("場地名稱", v.name); if (n && n.trim()) start(() => updateVenue(v.id, { name: n.trim() })); }}>改名</button>
          <button disabled={pending} className="text-sm text-gray-600" onClick={() => start(() => updateVenue(v.id, { is_active: !v.is_active }))}>{v.is_active ? "停用" : "啟用"}</button>
        </li>))}</ul>
    </div>
  );
}
```

- [ ] **Step 2: 驗證與 commit**

管理員假帳號可新增、改名、停用；停用後開場表單下拉不再出現；一般成員訪問 404。
```bash
git add -A && git commit -m "feat(venues): 管理員場地維護"
```

---

### Task 14: Cloudflare Workers 部署與 LIFF 接上線

**Files:**
- Create: `open-next.config.ts`, `wrangler.jsonc`, `.dev.vars`（不進 repo）
- Modify: `package.json` scripts, `next.config.ts`

**Interfaces:**
- Produces: 線上網址 `https://aama-tennis-club.<account>.workers.dev`

- [ ] **Step 1: 安裝與設定**

```bash
npm install @opennextjs/cloudflare@latest
npm install -D wrangler@latest
```

`open-next.config.ts`:
```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig({});
```

`wrangler.jsonc`:
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "aama-tennis-club",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "vars": { "NEXT_PUBLIC_LIFF_ID": "", "LINE_CHANNEL_ID": "" }
}
```
（`NEXT_PUBLIC_LIFF_ID` 是建置期寫進 bundle，所以建置前也要放在 `.env.production` 或 shell 環境變數；`vars` 只是備份給執行期。）

`next.config.ts`:
```ts
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
const nextConfig: NextConfig = {};
export default nextConfig;
```

`package.json` scripts 加：
```json
"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
```

`.dev.vars`（本機 preview 用，內容同 `.env.local` 再加 `NEXTJS_ENV=development`）。

- [ ] **Step 2（用戶操作）: Cloudflare 帳號與登入**

1. 到 https://dash.cloudflare.com/sign-up 註冊（免費方案）。
2. 本機：`npx wrangler login` → 瀏覽器授權。
3. `npx wrangler whoami` 確認帳號。

- [ ] **Step 3: 本機 preview 與首次部署**

```bash
npm run preview          # 在 workerd 跑，確認假登入與頁面正常
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SECRET_KEY
npx wrangler secret put SESSION_SECRET
npm run deploy
```
記下輸出的 `https://aama-tennis-club.<account>.workers.dev`。正式環境不要設 `DEV_FAKE_LOGIN`。

- [ ] **Step 4（用戶操作）: LINE Developers 建 LIFF**

1. https://developers.line.biz/console/ 用 LINE 帳號登入 → Create a new provider（名稱：AAMA 網球社）。
2. Create a new channel → 類型 **LINE Login**：Channel name「AAMA 網球社」、Region Taiwan、App types 勾 Web app。
3. 進 channel → 分頁 **LIFF** → Add：LIFF app name「網球社」、Size Full、Endpoint URL 填 Step 3 的 workers.dev 網址、Scopes 勾 `profile` 與 `openid`、Bot link feature 選 Off。
4. 記下 **LIFF ID**（形如 `2010340767-xxxxxxxx`）與 Basic settings 的 **Channel ID**。
5. 一開始 channel 狀態是 Developing，只有 channel 管理員能登入；到 Basic settings 把它切成 **Published** 讓所有人可用。

- [ ] **Step 5: 回填設定並重新部署**

`.env.production`（可進 repo，內容非機密）:
```
NEXT_PUBLIC_LIFF_ID=<LIFF ID>
```
`wrangler.jsonc` 的 `vars` 填入 `NEXT_PUBLIC_LIFF_ID` 與 `LINE_CHANNEL_ID`，然後：
```bash
npm run deploy
```

- [ ] **Step 6: 驗收**

1. 手機 LINE 開 `https://liff.line.me/<LIFF ID>` → 自動登入、看到場次頁、頭像名稱正確。
2. 電腦瀏覽器開 workers.dev 網址 → 跳 LINE 登入頁 → 登入後回到場次頁。
3. 在 LINE 內開場 → 分享到一個群組 → 群組成員點開直接接龍。
4. 走完：接龍到額滿、候補遞補、截止、結算、收款、統計。
5. 在 Supabase SQL Editor 把你的帳號設為管理員：`update members set role='admin' where display_name='<你的 LINE 名稱>';`

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: Cloudflare Workers 部署設定（OpenNext）"
git push
```

---

## Self-Review

- **Spec coverage**：§2 架構 → Task 1/3/4/5/14；§3 資料模型 → Task 3；§4.1 狀態 → Task 2；§4.2 開場 → Task 7；§4.3 接龍候補 → Task 3/8；§4.4 結算重算 → Task 3/12；§4.5 收款 → Task 12 + Task 9 待付款；§4.6 取消 → Task 7/11；§4.7 統計 → Task 2/10；§5 登入安全 → Task 4/5；§6 六個頁面 → Task 6–13；§8 測試 → Task 2/3/4/5；§10 外部設定 → Task 3 Step 1、Task 14。
- **已知取捨**：候補排行榜「顯示前 8 可展開」簡化為全部列出；LIFF 分享用 text message 而非 Flex Message（Phase 2 可美化）。
- **型別一致性**：`EventInput.registration_deadline` 全程是 `YYYY-MM-DDTHH:mm`（台北），寫入時補 `:00+08:00`；`hm()` 統一 `HH:mm`；`MemberLite`、`RegistrationWithMember`、`EventWithCounts` 於 Task 6 定義並在 8–12 使用。

---

## PIVOT — Cloudflare D1 replaces Supabase (2026-09-13)

Task 1 (scaffold) and Task 2 (domain functions) are pure code with no DB coupling and stand as completed. Everything from Task 3 onward is superseded by the tasks below. Ignore the original Task 3–14 for anything DB-shaped.

### D1 assets already provisioned

- Cloudflare account id `<CLOUDFLARE_ACCOUNT_ID>`
- D1 dev database `tennis-club-dev` id `<D1_DEV_DATABASE_ID>` (APAC region)
- D1 prod database `tennis-club-prod` — created at Task 14 time.

### Task 3 (D1): schema, migrations, D1 access, first integration test

**Files:**
- Create: `d1/migrations/0001_schema.sql`, `d1/migrations/0002_seed_dev.sql` (dev-only fixture data), `wrangler.jsonc`, `open-next.config.ts`, `.dev.vars.example`, `src/lib/env.ts`, `src/lib/db/client.ts`, `src/lib/db/types.ts`, `src/lib/db/uuid.ts`, `tests/db/registration-flow.test.ts`
- Modify: `next.config.ts`, `package.json` (scripts), `.gitignore` (`.wrangler/`, `.dev.vars`)

**Interfaces produced (later tasks import these):**
- `env`: `env.LINE_CHANNEL_ID`, `env.SESSION_SECRET`, `env.DEV_FAKE_LOGIN`, `env.NEXT_PUBLIC_LIFF_ID`
- `getDb(): Promise<D1Database>` from `src/lib/db/client.ts` (server-only; uses `getCloudflareContext({async: true})`)
- `newId(): string` = `crypto.randomUUID()`
- Types (same shape as spec §3, string columns): `Member`, `Venue`, `EventRow`, `Registration`

- [ ] **Step 1: Install OpenNext + wrangler + local D1 tooling**

```bash
cd "$HOME/Documents/Other Projects/aama-tennis-club-member-system"
npm install @opennextjs/cloudflare
npm install -D wrangler
```

- [ ] **Step 2: `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "aama-tennis-club",
  "main": ".open-next/worker.js",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
  "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tennis-club-dev",
      "database_id": "<D1_DEV_DATABASE_ID>",
      "migrations_dir": "d1/migrations"
    }
  ],
  "vars": { "NEXT_PUBLIC_LIFF_ID": "" }
}
```

- [ ] **Step 3: `open-next.config.ts` + `next.config.ts`**

`open-next.config.ts`:
```ts
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
export default defineCloudflareConfig({});
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
const nextConfig: NextConfig = {};
export default nextConfig;
```

- [ ] **Step 4: `.dev.vars.example`, `.gitignore` and package scripts**

`.dev.vars.example`:
```
NEXTJS_ENV=development
LINE_CHANNEL_ID=
SESSION_SECRET=
DEV_FAKE_LOGIN=1
```

`.gitignore` add:
```
.wrangler/
.dev.vars
.open-next/
```

`package.json` scripts:
```json
"cf:dev": "wrangler d1 migrations apply DB --local",
"cf:seed": "wrangler d1 execute DB --local --file d1/migrations/0002_seed_dev.sql",
"preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
"deploy": "opennextjs-cloudflare build && opennextjs-cloudflare deploy"
```

- [ ] **Step 5: Schema migration**

`d1/migrations/0001_schema.sql`:
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  picture_url TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE venues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_date TEXT NOT NULL,                    -- YYYY-MM-DD (台北)
  start_time TEXT NOT NULL,                    -- HH:mm
  end_time TEXT NOT NULL,                      -- HH:mm
  venue_id TEXT NOT NULL REFERENCES venues(id),
  capacity INTEGER NOT NULL DEFAULT 8 CHECK (capacity >= 1),
  registration_deadline TEXT NOT NULL,         -- ISO with +08:00 offset
  estimated_total INTEGER CHECK (estimated_total IS NULL OR estimated_total >= 0),
  final_total INTEGER CHECK (final_total IS NULL OR final_total >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  organizer_id TEXT NOT NULL REFERENCES members(id),
  settled_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_time > start_time)
);
CREATE INDEX events_date_idx ON events(event_date);
CREATE INDEX events_organizer_idx ON events(organizer_id);

CREATE TABLE registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  status TEXT NOT NULL CHECK (status IN ('confirmed','waitlisted')),
  seat_no INTEGER NOT NULL,                    -- 1..N; confirmed if seat_no <= capacity
  attended INTEGER,                            -- 0/1 nullable
  amount_due INTEGER,
  paid_at TEXT,
  paid_amount INTEGER,
  paid_marked_by TEXT REFERENCES members(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(event_id, member_id),
  UNIQUE(event_id, seat_no)
);
CREATE INDEX registrations_member_idx ON registrations(member_id);
```

- [ ] **Step 6: `src/lib/env.ts`, `src/lib/db/uuid.ts`, `src/lib/db/types.ts`, `src/lib/db/client.ts`**

`src/lib/env.ts`:
```ts
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`缺少環境變數 ${name}`);
  return v;
}
export const env = {
  get LINE_CHANNEL_ID() { return req("LINE_CHANNEL_ID"); },
  get SESSION_SECRET() { return req("SESSION_SECRET"); },
  get DEV_FAKE_LOGIN() { return process.env.DEV_FAKE_LOGIN === "1"; },
};
```

`src/lib/db/uuid.ts`:
```ts
export const newId = (): string => crypto.randomUUID();
```

`src/lib/db/types.ts`:
```ts
import type { EventStatus } from "@/lib/domain/event-status";
export type Member = { id: string; line_user_id: string; display_name: string; picture_url: string | null; role: "member" | "admin"; created_at: string; last_login_at: string };
export type Venue = { id: string; name: string; address: string | null; is_active: number; created_by: string | null };
export type EventRow = { id: string; title: string; event_date: string; start_time: string; end_time: string; venue_id: string; capacity: number; registration_deadline: string; estimated_total: number | null; final_total: number | null; status: EventStatus; organizer_id: string; settled_at: string | null; note: string | null; created_at: string; updated_at: string };
export type Registration = { id: string; event_id: string; member_id: string; status: "confirmed" | "waitlisted"; seat_no: number; attended: number | null; amount_due: number | null; paid_at: string | null; paid_amount: number | null; paid_marked_by: string | null; created_at: string };
```

`src/lib/db/client.ts`:
```ts
import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Env = { DB: D1Database };

export async function getDb(): Promise<D1Database> {
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as unknown as Env).DB;
  if (!db) throw new Error("D1 binding DB 不存在，請確認 wrangler.jsonc 與 initOpenNextCloudflareForDev()");
  await db.prepare("PRAGMA foreign_keys = ON").run();
  return db;
}
```

- [ ] **Step 7: Apply migration locally**

```bash
npm run cf:dev   # applies 0001_schema.sql to local D1
npx wrangler d1 execute DB --local --command "SELECT name FROM sqlite_master WHERE type='table'"
```
Expect `members`, `venues`, `events`, `registrations` listed.

- [ ] **Step 8: Integration test (skipped when D1 not reachable)**

`tests/db/registration-flow.test.ts` runs the full register / cancel / promote / capacity change / settle flow against a local test D1 via miniflare's D1. Test uses `unstable_dev` from wrangler or a lightweight sqlite-in-memory shim. Skip if `RUN_D1_TESTS !== "1"`.

**Note:** Given miniflare's stability caveats, this task's PRIMARY verification is the schema apply + a manual SQL smoke via `wrangler d1 execute`. The register/cancel/promote logic will be tested via unit tests over pure functions in Task 3.5 (seat-number domain math) plus real dev D1 usage in later tasks.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(db): D1 schema、wrangler + OpenNext 設定、D1 client、型別"
```

### Task 3.5 (new): pure seat-number domain functions + tests

Extract the seat-number calculations that back register/cancel/promote/capacity-change into `src/lib/domain/seats.ts`, and cover them with unit tests. This lets us TDD the tricky part without touching D1.

**Files:** Create `src/lib/domain/seats.ts`, `tests/domain/seats.test.ts`.

**Exports:**
- `nextSeatFrom(existing: number[]): number` — highest + 1, or 1 if empty
- `applyCancel(state: RegRow[], memberId: string): { after: RegRow[]; movedIn: string | null }` — deletes the member's row, closes the gap by decrementing seat_no of higher rows, returns whoever transitioned from waitlisted to confirmed (if any).
- `recomputeStatus(rows: RegRow[], capacity: number): RegRow[]` — set each row's status by `seat_no <= capacity`.

Tests cover: empty → seat 1; add to gap-free tail; cancel middle closes gap; cancel head promotes exactly one waitlister; capacity increase promotes waitlisters in order.

### Task 4 (D1 rewrite): actions/registrations.ts uses D1 batches

Replaces the plan's Task 8 `register`/`cancel` etc. Same signatures (`register(eventId)`, `cancel(eventId)`, `organizerAdd`, `organizerRemove`) but implemented via D1 batches + retry:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/client";
import { newId } from "@/lib/db/uuid";
import { requireMember, isAdmin } from "@/lib/auth/current-member";

async function assertOpenAndAllowed(eventId: string, memberId: string, actorId: string) { /* select event, check status/deadline (organizer/admin bypasses deadline) */ }

async function tryInsertSeat(db: D1Database, eventId: string, memberId: string, capacity: number): Promise<boolean> {
  const max = (await db.prepare("SELECT COALESCE(MAX(seat_no),0) AS m FROM registrations WHERE event_id=?").bind(eventId).first<{ m: number }>())?.m ?? 0;
  const seat = max + 1;
  const status = seat <= capacity ? "confirmed" : "waitlisted";
  try {
    await db.prepare("INSERT INTO registrations (id, event_id, member_id, status, seat_no) VALUES (?, ?, ?, ?, ?)")
      .bind(newId(), eventId, memberId, status, seat).run();
    return true;
  } catch (e) {
    if (/UNIQUE.*event_id.*seat_no/.test(String((e as Error).message))) return false;
    throw e;
  }
}

export async function register(eventId: string): Promise<void> {
  const me = await requireMember();
  const db = await getDb();
  const evt = await db.prepare("SELECT capacity, status, registration_deadline, organizer_id FROM events WHERE id=?").bind(eventId).first<{ capacity: number; status: string; registration_deadline: string; organizer_id: string }>();
  if (!evt) throw new Error("場次不存在");
  if (evt.status !== "open") throw new Error("場次已結算或取消");
  if (new Date(evt.registration_deadline).getTime() <= Date.now() && evt.organizer_id !== me.id && !isAdmin(me)) throw new Error("已超過結束報名時間");
  const dup = await db.prepare("SELECT 1 FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, me.id).first();
  if (dup) throw new Error("已經報名過了");
  for (let i = 0; i < 3; i++) {
    if (await tryInsertSeat(db, eventId, me.id, evt.capacity)) break;
    if (i === 2) throw new Error("排隊繁忙，請再試一次");
  }
  revalidatePath("/"); revalidatePath("/me"); revalidatePath(`/events/${eventId}`); revalidatePath(`/manage/${eventId}`);
}

export async function cancel(eventId: string): Promise<void> {
  const me = await requireMember();
  const db = await getDb();
  const evt = await db.prepare("SELECT capacity, status, registration_deadline, organizer_id FROM events WHERE id=?").bind(eventId).first<{ capacity: number; status: string; registration_deadline: string; organizer_id: string }>();
  if (!evt) throw new Error("場次不存在");
  if (evt.status !== "open") throw new Error("場次已結算或取消");
  if (new Date(evt.registration_deadline).getTime() <= Date.now() && evt.organizer_id !== me.id && !isAdmin(me)) throw new Error("已超過結束報名時間");
  const row = await db.prepare("SELECT seat_no FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, me.id).first<{ seat_no: number }>();
  if (!row) throw new Error("你沒有報名這場");
  await db.batch([
    db.prepare("DELETE FROM registrations WHERE event_id=? AND member_id=?").bind(eventId, me.id),
    db.prepare("UPDATE registrations SET seat_no = seat_no - 1 WHERE event_id=? AND seat_no > ?").bind(eventId, row.seat_no),
    db.prepare(`UPDATE registrations SET status = CASE WHEN seat_no <= ? THEN 'confirmed' ELSE 'waitlisted' END WHERE event_id=?`).bind(evt.capacity, eventId),
  ]);
  revalidatePath("/"); revalidatePath("/me"); revalidatePath(`/events/${eventId}`); revalidatePath(`/manage/${eventId}`);
}
```

`organizerAdd` / `organizerRemove` are the same helpers with the "actor is organizer/admin" check instead of self.

### Task 4b (D1 rewrite): actions/events.ts

Same signatures as original Task 7. `createEvent` inserts event + calls `register` internally; `updateEvent` for capacity delta runs the recompute-status UPDATE; `cancelEvent` sets status='cancelled'. Uses `getDb()` + prepared statements. `eventInputSchema` unchanged.

### Task 4c (D1 rewrite): actions/settlement.ts

Same signatures. `settleEvent`:
```sql
UPDATE registrations SET attended = CASE WHEN member_id IN (?, ?, ...) THEN 1 ELSE 0 END,
                         amount_due = CASE WHEN member_id IN (?, ?, ...) THEN ? ELSE 0 END
WHERE event_id = ?;
UPDATE events SET status='settled', final_total=?, settled_at=? WHERE id=?;
```
`markPaid` / `unmarkPaid` are single UPDATEs.

### Task 5 (D1 rewrite): queries.ts

Same exported names/signatures as Task 6. Implementations use D1 prepared statements + hand-written joins (SQLite has no `select("*, venue:venues(*)")` sugar). Each function does its joins in SQL and shapes the result into `EventWithCounts` / `RegistrationWithMember`.

Example:
```ts
export async function listEvents(): Promise<EventWithCounts[]> {
  const db = await getDb();
  const rows = await db.prepare(`
    SELECT e.*,
           v.id AS v_id, v.name AS v_name, v.address AS v_address, v.is_active AS v_is_active, v.created_by AS v_created_by,
           o.id AS o_id, o.display_name AS o_display_name, o.picture_url AS o_picture_url,
           (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.status='confirmed') AS confirmed_count,
           (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id AND r.status='waitlisted') AS waitlist_count
    FROM events e JOIN venues v ON v.id = e.venue_id JOIN members o ON o.id = e.organizer_id
    WHERE e.status != 'cancelled'
    ORDER BY e.event_date, e.start_time
  `).all<Record<string, unknown>>();
  return rows.results.map(mapEventRow);
}
```
A tiny helper `mapEventRow(row)` groups `v_*` / `o_*` back into `venue` / `organizer` sub-objects.

### Task 14 (D1 rewrite): deploy

Same shape as original Task 14. Add:
- Create prod D1: `npx wrangler d1 create tennis-club-prod` (or via MCP) → paste id into wrangler.jsonc under `env.production.d1_databases`.
- Apply migrations to prod: `npx wrangler d1 migrations apply DB --remote`.
- Set secrets: `wrangler secret put SESSION_SECRET`, `LINE_CHANNEL_ID`.
- LIFF Endpoint URL points at workers.dev; env vars for `NEXT_PUBLIC_LIFF_ID` set in `wrangler.jsonc` vars (public) and rebuilt.

All other implementation tasks (T6 UI shell, T9 我的, T10 統計, T11 管理, T13 場地維護) are unchanged — they consume the same query/action interfaces which we kept name-compatible.
