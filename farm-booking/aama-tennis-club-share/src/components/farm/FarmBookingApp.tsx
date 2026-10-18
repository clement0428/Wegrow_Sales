"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, CalendarDays, CalendarPlus, Check, ChevronRight, Clock3,
  Car, CloudRain, CreditCard, ExternalLink, Footprints, Info, LoaderCircle, MapPin,
  MessageCircle, Minus, Plus, ReceiptText, RefreshCw, ShieldCheck, ShoppingBasket,
  Sprout, Ticket, Users,
} from "lucide-react";
import {
  calculateVisitPrice,
  MEAL_PRICE_TWD,
  PLANT_PRICE_TWD,
  TICKET_PRICE_TWD,
} from "@/lib/farm/pricing";
import FarmDateCalendar from "./FarmDateCalendar";
import { ORDER_STEPS, stepIndexOf, type StatusBucket } from "@/lib/farm/status";
import { clearBookingDraft, restoreBookingDraft, saveBookingDraft } from "@/lib/farm/booking-draft";

export type FarmView = "booking" | "mine" | "info" | "contact";

export type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
  existingGroups: number[];
  maxNewGroupSize: number;
  available: boolean;
  experience: string;
  ticketRateBps: number;
  confirmedGroupCount: number;
  holdGroupCount: number;
};

type AvailabilityPayload = {
  mode: "preview" | "live";
  source: string;
  published: boolean;
  people: number;
  notice: string;
  slots: Slot[];
};

type CheckoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "blocked"; message: string }
  | { status: "reserved"; bookingNumber: string; lookupCode: string; message: string; statusBucket: StatusBucket };

// 認養企業客戶的免費參訪資格（2026-10-17；Clement特別邀請連結尚未上線，這裡
// 先只服務認養客戶）：nonce只在Orbit用真實帳密核發eligible之後、瀏覽器被導回來
// 時才會進入"confirmed"——"confirmed"只是前端UX狀態，真正能不能免費仍由後端
// 在送出預約時再跟Orbit兌換一次nonce決定，前端這個狀態不是信任邊界。
//
// 2026-10-17二次修正：原本只有"denied"一種失敗狀態，把「服務本身故障」「驗證
// session過期/跨瀏覽器失效」「核對過真的不符合資格」三種完全不同的情況混在一起
// ——系統故障不能顯示成「你的資格未通過」。
type EligibilityState =
  | { status: "none" }
  | { status: "pending" }
  | { status: "confirmed"; nonce: string; expiresAt: string }
  | { status: "unavailable" } // 服務本身打不通/暫時無法使用（含migration未完成）
  | { status: "stale" } // 驗證session過期、已用過、或跨瀏覽器/重新整理後失效
  | { status: "not_eligible" }; // 核對過真實登入身分跟合約後，確實不符合資格

const ELIGIBILITY_STORAGE_KEY = "tc-eligibility-state";

// 2026-10-18審查修正：原本只有"confirmed"會寫入sessionStorage，其餘狀態
// （包含"unavailable"/"stale"/"not_eligible"）一律清空儲存——代表客戶遇到503
// 之後重新整理頁面，畫面會靜默變回"none"（完全沒驗證過的狀態），submitBooking()
// 的擋付費邏輯只檔unavailable/stale，"none"不會被擋，等於重新整理就能繞過
// 「只有明確選擇改為付費才能送出」這條規則。免費意圖本身（不只是確認成功的
// 那個nonce）要能跨重新整理存活，必須明確呼叫switchToPaidBooking()才能清除。
const PERSISTABLE_ELIGIBILITY_STATUSES = new Set(["confirmed", "unavailable", "stale", "not_eligible"]);

function persistEligibility(state: EligibilityState) {
  try {
    if (PERSISTABLE_ELIGIBILITY_STATUSES.has(state.status)) sessionStorage.setItem(ELIGIBILITY_STORAGE_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(ELIGIBILITY_STORAGE_KEY);
  } catch { /* sessionStorage不可用（隱私模式等）就放棄持久化，不影響本次流程 */ }
}

// 回跳與重新整理不能無提示丟失免費意圖（不管是已確認、還是卡在unavailable/
// stale/not_eligible 任何一種「還沒解決」的狀態）——React state在整頁重新整理
// 後會清空，這裡用sessionStorage補回來；已確認的nonce如果存的時候還沒過期、
// 但現在已經過期，回傳"stale"而不是靜默當作"none"，讓畫面能明確告知「先前的
// 驗證已過期，需要重新驗證」，不能被重新整理繞過變回可以直接付費送出。
function restoreEligibility(): EligibilityState | null {
  try {
    const raw = sessionStorage.getItem(ELIGIBILITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EligibilityState;
    if (!PERSISTABLE_ELIGIBILITY_STATUSES.has(parsed.status)) return null;
    if (parsed.status === "confirmed") {
      if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
        const stale: EligibilityState = { status: "stale" };
        sessionStorage.setItem(ELIGIBILITY_STORAGE_KEY, JSON.stringify(stale));
        return stale;
      }
      return parsed;
    }
    return parsed;
  } catch {
    return null;
  }
}

type BookingRecord = {
  bookingNumber: string;
  lookupCode: string;
  contactName: string;
  totalPeople: number;
  plantCount: number;
  mealCount: number;
  amountTwd: number;
  bookingStatus: string;
  paymentStatus: string;
  startsAt: string;
  endsAt: string;
  experience: string;
  statusBucket: StatusBucket;
};

type LineIdentity =
  | { status: "disabled" | "loading" | "guest" | "error"; displayName?: never }
  | { status: "ready"; displayName: string };

const weekday = new Intl.DateTimeFormat("zh-TW", { weekday: "short", timeZone: "Asia/Taipei" });
const monthDay = new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", timeZone: "Asia/Taipei" });
const fullDate = new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Taipei" });
const timeOnly = new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Taipei" });

export default function FarmBookingApp({ initialView = "booking" }: { initialView?: FarmView }) {
  const [view, setView] = useState<FarmView>(initialView);
  const [step, setStep] = useState(1);
  const [adult, setAdult] = useState(2);
  const [child, setChild] = useState(0);
  const [infant, setInfant] = useState(0);
  const [plantCount, setPlantCount] = useState(0);
  const [mealCount, setMealCount] = useState(0);
  const [vegetarianMealCount, setVegetarianMealCount] = useState(0);
  const [dateFilter, setDateFilter] = useState("");
  const [slotId, setSlotId] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [availability, setAvailability] = useState<"loading" | "ready" | "error">("loading");
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [previewMode, setPreviewMode] = useState(true);
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [groupName, setGroupName] = useState("");
  const [note, setNote] = useState("");
  const [consented, setConsented] = useState(false);
  const [checkout, setCheckout] = useState<CheckoutState>({ status: "idle" });
  const [eligibility, setEligibility] = useState<EligibilityState>({ status: "none" });
  const [lineIdentity, setLineIdentity] = useState<LineIdentity>({
    status: process.env.NEXT_PUBLIC_LIFF_ID ? "loading" : "disabled",
  });
  const idempotencyKey = useRef("");
  const people = adult + child + infant;

  // idempotencyKey要在「重新整理也保得住」的時間點就固定下來，不能像舊版一樣
  // 等到submitBooking()第一次送出時才臨時產生——否則Orbit已經兌換成功、本機
  // booking建立失敗、客戶重新整理頁面重試，拿到的就是全新一把key，跟原本那次
  // 失敗的嘗試變成兩個不相干的請求，既有的redemption_id冪等重試機制完全用不上。
  function ensureIdempotencyKey(): string {
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
    return idempotencyKey.current;
  }

  useEffect(() => {
    const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
    if (!liffId) return;
    let cancelled = false;
    (async () => {
      try {
        const liff = (await import("@line/liff")).default;
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          setLineIdentity({ status: "guest" });
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) throw new Error("LINE 未提供登入憑證");
        const response = await fetch("/api/auth/line", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken }),
        });
        const result = await response.json() as { member?: { displayName?: string }; error?: string };
        if (!response.ok || !result.member?.displayName) throw new Error(result.error || "LINE 登入驗證失敗");
        if (!cancelled) {
          setLineIdentity({ status: "ready", displayName: result.member.displayName });
          setContactName((name) => name || result.member?.displayName || "");
        }
      } catch {
        if (!cancelled) setLineIdentity({ status: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Mirrors the real liff.init()/login state above for external observability
  // (postdeploy verification, monitoring) — never sets this from anywhere
  // other than the actual init flow's own state transitions, so it can't
  // mask a real failure by reporting a state the SDK didn't actually reach.
  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as unknown as { __LIFF_INIT_STATE__?: string }).__LIFF_INIT_STATE__ = lineIdentity.status;
    }
  }, [lineIdentity.status]);

  // 客戶從Orbit登入頁被導回來：URL帶eligibilityNonce+eligible+eligibilityExpiresAt
  // （純UX提示，不是信任邊界——真正核對在submitBooking()送出時由後端跟Orbit再
  // 兌換一次）。讀完立刻清掉URL參數，避免重新整理頁面時重複觸發或留在瀏覽紀錄裡。
  // eligible=1→確認免費；eligible=0→claim核對過真的不符合資格；eligible=error→
  // 服務本身打不通，不能顯示成「資格未通過」（見farm-portal.html的對應修正）。
  // 如果不是從Orbit導回來的，改檢查sessionStorage有沒有先前確認過還沒過期的
  // 資格——重新整理頁面不該無提示把已確認的免費資格弄丟。
  useEffect(() => {
    // 先復原重新整理前留下的booking draft（表單欄位+idempotencyKey）——不管
    // 這次是不是從Orbit導回來的，都要先把這些欄位接回來，避免客戶重新整理後
    // 要重填一次聯絡資料，也讓後面不管是沿用舊nonce還是走全新一輪驗證，
    // idempotencyKey都維持同一把。
    const draft = restoreBookingDraft();
    if (draft) {
      idempotencyKey.current = draft.idempotencyKey;
      if (draft.slotId) setSlotId(draft.slotId);
      setAdult(draft.adult); setChild(draft.child); setInfant(draft.infant);
      setPlantCount(draft.plantCount); setMealCount(draft.mealCount); setVegetarianMealCount(draft.vegetarianMealCount);
      setContactName(draft.contactName); setPhone(draft.phone); setGroupName(draft.groupName); setNote(draft.note);
    }

    const params = new URLSearchParams(window.location.search);
    const nonce = params.get("eligibilityNonce");
    if (!nonce) {
      // 不是從Orbit導回來的——檢查sessionStorage有沒有先前確認過還沒過期的
      // 免費資格（重新整理頁面不該無提示把已確認的免費資格弄丟）。
      const restored = restoreEligibility();
      if (restored) setEligibility(restored);
      if (draft?.slotId) setStep(3);
      return;
    }
    const eligible = params.get("eligible");
    const expiresAt = params.get("eligibilityExpiresAt");
    const returnedSlotId = params.get("slotId");
    if (eligible === "1" && expiresAt) {
      const confirmed: EligibilityState = { status: "confirmed", nonce, expiresAt };
      setEligibility(confirmed);
      persistEligibility(confirmed);
    } else if (eligible === "error") {
      setEligibility({ status: "unavailable" });
    } else {
      setEligibility({ status: "not_eligible" });
    }
    if (returnedSlotId) setSlotId(returnedSlotId);
    const a = Number(params.get("adultCount"));
    const c = Number(params.get("childCount"));
    const i = Number(params.get("infantCount"));
    if (Number.isInteger(a) && a >= 1) setAdult(a);
    if (Number.isInteger(c) && c >= 0) setChild(c);
    if (Number.isInteger(i) && i >= 0) setInfant(i);
    setStep(3);
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // 任何時候slotId存在（代表至少已經到過step 2），就持續把目前表單狀態存成
  // draft——重新整理頁面、或離開去Orbit登入再回來，都能接得回來。
  useEffect(() => {
    if (!slotId) return;
    saveBookingDraft({
      idempotencyKey: ensureIdempotencyKey(),
      slotId, adult, child, infant, plantCount, mealCount, vegetarianMealCount,
      contactName, phone, groupName, note,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId, adult, child, infant, plantCount, mealCount, vegetarianMealCount, contactName, phone, groupName, note]);

  async function startEligibilityClaim() {
    if (!slotId) return;
    setEligibility({ status: "pending" });
    // 離開去Orbit登入之前先確保idempotencyKey+draft都存好——回來後（或中途
    // 重新整理）才能沿用同一把key，不會變成另一次不相干的booking嘗試。
    saveBookingDraft({
      idempotencyKey: ensureIdempotencyKey(),
      slotId, adult, child, infant, plantCount, mealCount, vegetarianMealCount,
      contactName, phone, groupName, note,
    });
    try {
      const response = await fetch("/api/farm/eligibility/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slotId, adultCount: adult, childCount: child, infantCount: infant }),
      });
      const result = await response.json() as { orbitRedirectUrl?: string; error?: string; code?: string };
      if (!response.ok || !result.orbitRedirectUrl) {
        setEligibility(response.status === 503 || result.code === "eligibility_feature_unavailable" ? { status: "unavailable" } : { status: "not_eligible" });
        return;
      }
      window.location.href = result.orbitRedirectUrl;
    } catch {
      setEligibility({ status: "unavailable" });
    }
  }

  // 只有客戶明確點「改為一般付費預約」才能移除免費意圖——503/逾時/過期這幾種
  // 狀態都不能自動滑進付費送出，必須是這個函式被呼叫才算數。
  function switchToPaidBooking() {
    setEligibility({ status: "none" });
    persistEligibility({ status: "none" });
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/farm/availability?people=${people}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as AvailabilityPayload | { error?: string };
        if (!response.ok || !("slots" in data)) {
          const message = "error" in data ? data.error : undefined;
          throw new Error(message || "無法載入農場開放日");
        }
        setSlots(data.slots);
        setPreviewMode(data.mode !== "live" || !data.published);
        setAvailabilityMessage(data.notice);
        setAvailability("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSlots([]);
        setAvailabilityMessage(error instanceof Error ? error.message : "無法載入農場開放日");
        setAvailability("error");
      });
    return () => controller.abort();
  }, [people]);

  const openDates = useMemo(() => Array.from(new Map(slots.map((slot) => {
    const start = new Date(slot.startsAt);
    const key = slot.startsAt.slice(0, 10);
    return [key, { key, label: `${monthDay.format(start)} ${weekday.format(start)}` }];
  })).values()), [slots]);
  const activeDate = openDates.some((date) => date.key === dateFilter) ? dateFilter : (openDates[0]?.key ?? "");
  const availableSlots = useMemo(() => slots.filter((slot) => slot.available && slot.startsAt.startsWith(activeDate)), [activeDate, slots]);
  const selectedSlot = slots.find((slot) => slot.id === slotId) ?? null;
  const ticketRateBps = selectedSlot?.ticketRateBps ?? 10_000;
  const price = calculateVisitPrice({ people, plantCount, mealCount, ticketRateBps });
  const validPhone = /^09\d{8}$/.test(phone.replace(/\D/g, ""));
  // 免費成立後要把票價、付款區、付費加購都藏起來——這幾項金額本來就會被後端
  // 強制清成0，畫面卻還留著門票單價/付款選項會讓客戶誤以為仍要付款或可以加購。
  const isFreeConfirmed = eligibility.status === "confirmed";
  // 免費意圖還沒解決（服務打不通／session過期／核對過不符合資格）都要擋付費
  // 送出——不能讓客戶在任何一種「未解決」狀態下悄悄送出一般計價預約，必須
  // 回上一步重新驗證，或明確按「改為一般付費預約」（switchToPaidBooking()）。
  const isEligibilityBlocking = eligibility.status === "unavailable" || eligibility.status === "stale" || eligibility.status === "not_eligible";

  function changeCount(kind: "adult" | "child" | "infant", delta: number) {
    const values = { adult, child, infant };
    const nextValue = Math.max(kind === "adult" ? 1 : 0, values[kind] + delta);
    const nextPeople = people - values[kind] + nextValue;
    if (kind === "adult") setAdult(nextValue);
    if (kind === "child") setChild(nextValue);
    if (kind === "infant") setInfant(nextValue);
    setAvailability("loading");
    setAvailabilityMessage("");
    setPlantCount((count) => Math.min(count, nextPeople));
    setMealCount((count) => Math.min(count, nextPeople));
    setVegetarianMealCount((count) => Math.min(count, nextPeople));
    setSlotId(null);
  }

  function changeView(next: FarmView) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitBooking() {
    if (!selectedSlot) return;
    // 503／逾時／資格過期都不能自動滑進一般付費送出——這幾種狀態下擋住送出，
    // 必須回上一步明確重新驗證或按「改為一般付費預約」才能繼續（見
    // switchToPaidBooking()）。
    if (isEligibilityBlocking) return;
    const key = ensureIdempotencyKey();
    setCheckout({ status: "loading" });
    try {
      const response = await fetch("/api/farm/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slotId: selectedSlot.id,
          adultCount: adult,
          childCount: child,
          infantCount: infant,
          plantCount,
          mealCount,
          vegetarianMealCount,
          contactName,
          phone: phone.replace(/\D/g, ""),
          groupName,
          note,
          idempotencyKey: key,
          ...(eligibility.status === "confirmed" ? { eligibilityNonce: eligibility.nonce } : {}),
        }),
      });
      const result = await response.json() as { booking?: BookingRecord; error?: string; message?: string; code?: string };
      if (!response.ok || !result.booking) {
        // 送出時後端又重新核對了一次資格（這才是真正的信任邊界）——如果這次核對
        // 翻盤，要把前端的"confirmed"狀態跟著更新掉並清除sessionStorage持久化，
        // 不能讓畫面繼續顯示「已確認免費」卻送不出去。
        if (result.code === "eligibility_feature_unavailable" || result.code === "eligibility_service_unavailable") {
          const next: EligibilityState = { status: "unavailable" };
          setEligibility(next); persistEligibility(next);
        } else if (result.code?.startsWith("eligibility_session_")) {
          const next: EligibilityState = { status: "stale" };
          setEligibility(next); persistEligibility(next);
        } else if (result.code === "not_eligible_for_free_visit") {
          const next: EligibilityState = { status: "not_eligible" };
          setEligibility(next); persistEligibility(next);
        }
        setCheckout({ status: "blocked", message: result.error || "無法建立預約，請重新確認場次。" });
        return;
      }
      clearBookingDraft();
      setCheckout({
        status: "reserved",
        bookingNumber: result.booking.bookingNumber,
        lookupCode: result.booking.lookupCode,
        message: result.message || "已收到預約申請。",
        statusBucket: result.booking.statusBucket,
      });
    } catch {
      setCheckout({ status: "blocked", message: "無法連接預約服務，請稍後再試。" });
    }
  }

  return (
    <main className="farm-app">
      <header className="app-header">
        <button className="app-brand" onClick={() => changeView("booking")} aria-label="回到預約首頁">
          <Image src="/brand/wegrow-logo.png" width={46} height={46} alt="WeGrow" />
          <span><strong>威果 WeGrow</strong><small>農場參訪預約</small></span>
        </button>
        <span className="line-chip"><MessageCircle /> {lineIdentity.status === "ready" ? `LINE 已連結：${lineIdentity.displayName}` : "LINE 服務"}</span>
      </header>

      {view === "booking" && (
        <>
          <section className="booking-intro">
            <div className="intro-photo"><Image src="/brand/wegrow-greenhouse.jpg" fill sizes="(max-width: 720px) 100vw, 520px" priority alt="WeGrow 麻豆科技溫室草莓" /></div>
            <div className="intro-copy">
              <span className="eyebrow">麻豆科技溫室</span>
              <h1>來麻豆，走進<br />威果科技農場</h1>
              <p>查看農場已開放的日期，選擇人數與體驗內容。</p>
              <div className="intro-facts"><span><Clock3 /> 約 90 分鐘</span><span><Ticket /> 門票可折抵當日消費</span><a href="https://maps.app.goo.gl/mde8o1215UvvtbBu8" target="_blank" rel="noreferrer"><MapPin /> 台南麻豆（Google Maps 導航）</a></div>
            </div>
          </section>

          {previewMode && <div className="preview-notice"><Info /><span><strong>系統預覽</strong> 場次尚未由正式資料庫發布。</span></div>}
          {!previewMode && <div className="preview-notice"><Info /><span><strong>場次已連接農場資料庫</strong> 週二至週四 14:00–18:00 可直接預約；週五、六、日請先聯繫客服。付款尚未開放。</span></div>}

          <nav className="stepper" aria-label="預約進度">
            {["方案", "時段", "資料", "確認"].map((label, index) => {
              const number = index + 1;
              return <button key={label} onClick={() => number < step && setStep(number)} className={number <= step ? "step active" : "step"}><span>{number < step ? <Check size={15} /> : number}</span>{label}</button>;
            })}
          </nav>

          <section className="booking-panel" aria-live="polite">
            {step === 1 && (
              <>
                <SectionHeading kicker="STEP 1" title="選擇這次的參訪內容" icon={<Sprout />} />
                {isFreeConfirmed ? (
                  <div className="blocked-result success-result"><Check /><div><strong>已確認免費參訪資格</strong><p>這次參訪不收門票費用，也暫不支援加購植栽或餐飲。</p></div></div>
                ) : (
                  <>
                    <div className="ticket-card">
                      <span><Ticket /></span>
                      <div><strong>農場門票與導覽</strong><p>平日 NT$ {TICKET_PRICE_TWD}／人；假日時段 NT$ 360／人。門票金額可折抵參訪當日現場選購。</p></div>
                      <b>必選</b>
                    </div>
                    <h3 className="field-title">加選體驗</h3>
                    <p className="section-help compact">先選數量，系統會把門票折抵金自動套用到本次選購。</p>
                    <div className="counter-list addon-list">
                      <Counter label="盆栽手作" note={`NT$ ${PLANT_PRICE_TWD}／盆`} value={plantCount} onMinus={() => setPlantCount(Math.max(0, plantCount - 1))} onPlus={() => setPlantCount(Math.min(people, plantCount + 1))} />
                      <Counter label="現場餐飲" note={`NT$ ${MEAL_PRICE_TWD}／人`} value={mealCount} onMinus={() => { const next = Math.max(0, mealCount - 1); setMealCount(next); setVegetarianMealCount((v) => Math.min(v, next)); }} onPlus={() => setMealCount(Math.min(people, mealCount + 1))} />
                      {mealCount > 0 && (
                        <Counter label="其中素食份數" note="葷食份數 = 餐飲總份數 − 素食份數" value={vegetarianMealCount} onMinus={() => setVegetarianMealCount(Math.max(0, vegetarianMealCount - 1))} onPlus={() => setVegetarianMealCount(Math.min(mealCount, vegetarianMealCount + 1))} />
                      )}
                    </div>
                    <div className="pricing-summary">
                      <PriceLine label={`門票 ${people} 人`} value={price.ticketSubtotalTwd} />
                      <PriceLine label="加選項目" value={price.addOnSubtotalTwd} />
                      <PriceLine label="本次門票折抵" value={-price.creditAppliedTwd} highlight />
                      <div className="pricing-total"><span>本次合計</span><strong>NT$ {price.totalTwd.toLocaleString()}</strong></div>
                      {price.creditRemainingTwd > 0 && <small>尚有 NT$ {price.creditRemainingTwd.toLocaleString()} 可於參訪當日折抵現場商品。</small>}
                    </div>
                  </>
                )}
                <h3 className="field-title">來訪人數</h3>
                <p className="section-help compact">成人、兒童與幼兒都會計入現場接待人數。</p>
                <div className="counter-list">
                  <Counter label="成人" note="門票計入折抵金" value={adult} onMinus={() => changeCount("adult", -1)} onPlus={() => changeCount("adult", 1)} />
                  <Counter label="兒童" note="年齡細則待核准" value={child} onMinus={() => changeCount("child", -1)} onPlus={() => changeCount("child", 1)} />
                  <Counter label="幼兒" note="仍計入接待名額" value={infant} onMinus={() => changeCount("infant", -1)} onPlus={() => changeCount("infant", 1)} />
                </div>
                <div className="summary-strip"><span>本次總人數</span><strong>{people} 位</strong></div>
                <button className="primary-button" onClick={() => setStep(2)}>查看農場開放日期 <ArrowRight /></button>
              </>
            )}

            {step === 2 && (
              <>
                <BackButton onClick={() => setStep(1)} />
                <SectionHeading kicker="STEP 2" title="選擇農場開放時段" icon={<CalendarDays />} />
                <p className="section-help">只顯示農場已建立、且能接待 {people} 位的日期與時段。</p>
                <div className="schedule-notice">
                  <strong>固定開放：週二、週三、週四 14:00–18:00</strong>
                  <span>週五、週六、週日需先聯繫客服討論，確認後由農場開放專屬時段；假日時段門票加 20%。</span>
                  <a href="https://line.me/R/ti/p/@647hlrhw" target="_blank" rel="noreferrer"><MessageCircle /> 聯繫官方 LINE</a>
                </div>
                {availability === "loading" && <div className="loading-state"><LoaderCircle /> 正在讀取農場開放日…</div>}
                {availability === "error" && <div className="empty-state"><strong>開放日載入失敗</strong><span>{availabilityMessage}</span><button onClick={() => window.location.reload()}><RefreshCw /> 重新載入</button></div>}
                {availability === "ready" && slots.length === 0 && <div className="empty-state"><strong>目前沒有可直接預約的場次</strong><span>週五、週六、週日請聯繫客服討論開放時間。</span><a href="https://line.me/R/ti/p/@647hlrhw" target="_blank" rel="noreferrer"><MessageCircle /> 聯繫官方 LINE</a></div>}
                {availability === "ready" && slots.length > 0 && (
                  <>
                    <FarmDateCalendar
                      slots={slots}
                      activeDate={activeDate}
                      onSelectDate={(key) => { setDateFilter(key); setSlotId(null); }}
                      showMine={lineIdentity.status === "ready"}
                    />
                    <div className="slot-list">
                      {availableSlots.map((slot) => {
                        const selected = slot.id === slotId;
                        const start = new Date(slot.startsAt);
                        const end = new Date(slot.endsAt);
                        return <button key={slot.id} className={selected ? "slot selected" : "slot"} onClick={() => setSlotId(slot.id)}>
                          <span className="slot-date"><strong>{monthDay.format(start)}</strong><small>{weekday.format(start)}</small></span>
                          <span className="slot-main"><strong>{timeOnly.format(start)}–{timeOnly.format(end)}</strong><small>{slot.experience}{slot.ticketRateBps > 10_000 ? " · 假日門票 NT$ 360／人" : ""}</small><em>可新增 1 團，這團最多 {slot.maxNewGroupSize} 人</em></span>
                          <span className="radio-dot">{selected && <Check size={15} />}</span>
                        </button>;
                      })}
                      {availableSlots.length === 0 && <div className="empty-state">這天目前沒有能接待 {people} 位的時段，請改選其他農場開放日。</div>}
                    </div>
                  </>
                )}
                {availabilityMessage && <p className="data-source">資料狀態：{availabilityMessage}</p>}
                <button className="primary-button" disabled={!slotId} onClick={() => setStep(3)}>填寫聯絡資料 <ArrowRight /></button>
              </>
            )}

            {step === 3 && selectedSlot && (
              <>
                <BackButton onClick={() => setStep(2)} />
                <SectionHeading kicker="STEP 3" title="聯絡與付款方式" icon={<ShieldCheck />} />
                <div className="form-grid">
                  <label>聯絡人姓名<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="例：王小明" /></label>
                  <label>手機號碼<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="0912 345 678" /><small className={phone && !validPhone ? "field-error" : ""}>{phone && !validPhone ? "請輸入正確的台灣手機號碼" : "用於預約與異動聯繫"}</small></label>
                  <label className="full">團體名稱（選填）<input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="家庭、公司或社團名稱" /></label>
                  <label className="full">備註<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="行動協助、孩童或其他需要農場先知道的事" /></label>
                </div>
                <h3 className="field-title">企業認養客戶免費參訪</h3>
                <div className="eligibility-block">
                  {eligibility.status === "none" && (
                    <>
                      <p className="section-help compact">若您是威果企業認養客戶，可登入 WeGrow Orbit 驗證免費參訪資格（不影響一般付費預約，不驗證就維持上方門票計價）。</p>
                      <button type="button" className="secondary-button" onClick={startEligibilityClaim}><ShieldCheck /> 登入驗證免費參訪資格</button>
                    </>
                  )}
                  {eligibility.status === "pending" && <div className="loading-state"><LoaderCircle /> 正在前往 WeGrow Orbit 登入…</div>}
                  {eligibility.status === "confirmed" && <div className="blocked-result success-result"><Check /><div><strong>已確認免費參訪資格</strong><p>這次參訪將不收取門票費用。</p></div></div>}
                  {eligibility.status === "unavailable" && (
                    <div className="blocked-result"><ShieldCheck /><div>
                      <strong>免費資格驗證暫時無法使用</strong>
                      <p>服務本身連線異常，不代表您的資格未通過——這筆預約暫時無法送出，可稍後重新驗證，或改用一般付費預約，也可聯繫威果官方 LINE 協助確認。</p>
                      <div className="eligibility-actions">
                        <button type="button" className="secondary-button" onClick={startEligibilityClaim}><ShieldCheck /> 重新驗證</button>
                        <button type="button" className="secondary-button" onClick={switchToPaidBooking}>改為一般付費預約</button>
                      </div>
                    </div></div>
                  )}
                  {eligibility.status === "stale" && (
                    <div className="blocked-result"><ShieldCheck /><div>
                      <strong>免費參訪資格驗證已過期或已使用</strong>
                      <p>這筆預約暫時無法送出，請重新登入認養企業帳號再驗證一次，或改用一般付費預約。</p>
                      <div className="eligibility-actions">
                        <button type="button" className="secondary-button" onClick={startEligibilityClaim}><ShieldCheck /> 重新驗證</button>
                        <button type="button" className="secondary-button" onClick={switchToPaidBooking}>改為一般付費預約</button>
                      </div>
                    </div></div>
                  )}
                  {eligibility.status === "not_eligible" && (
                    <div className="blocked-result"><ShieldCheck /><div>
                      <strong>核對後此帳號不符合免費參訪資格</strong>
                      <p>可改用一般付費預約，或聯繫威果官方 LINE 確認合約範圍。</p>
                      <div className="eligibility-actions">
                        <button type="button" className="secondary-button" onClick={switchToPaidBooking}>改為一般付費預約</button>
                      </div>
                    </div></div>
                  )}
                </div>
                {!isFreeConfirmed && (
                  <>
                    <h3 className="field-title">付款方式（尚未開放）</h3>
                    <div className="payment-options">
                      <button type="button" className="payment" disabled><MessageCircle /> LINE Pay <small>尚未開放付款</small></button>
                      <button type="button" className="payment" disabled><CreditCard /> 信用卡 <small>尚未開放付款</small></button>
                    </div>
                  </>
                )}
                <label className="consent"><input checked={consented} onChange={(event) => setConsented(event.target.checked)} type="checkbox" /> <span>我知道雨天活動照常；豪雨或颱風可能另行通知取消。入場會換拖鞋，場域地面不是平整水泥地，請勿奔跑並小心行走。</span></label>
                <button className="primary-button" disabled={!contactName.trim() || !validPhone || !consented} onClick={() => setStep(4)}>檢查預約內容 <ArrowRight /></button>
              </>
            )}

            {step === 4 && selectedSlot && (
              <>
                <BackButton onClick={() => { setCheckout({ status: "idle" }); setStep(3); }} />
                <SectionHeading kicker="STEP 4" title="確認預約內容" icon={<Check />} />
                <div className="review-block">
                  <ReviewRow icon={<CalendarDays />} label="日期" value={fullDate.format(new Date(selectedSlot.startsAt))} />
                  <ReviewRow icon={<Clock3 />} label="時段" value={`${timeOnly.format(new Date(selectedSlot.startsAt))}–${timeOnly.format(new Date(selectedSlot.endsAt))}`} />
                  <ReviewRow icon={<Users />} label="人數" value={`${people} 位（成人 ${adult}、兒童 ${child}、幼兒 ${infant}）`} />
                  {!isFreeConfirmed && <ReviewRow icon={<ShoppingBasket />} label="加選" value={mealCount > 0 ? `盆栽 ${plantCount}、餐飲 ${mealCount}（素食 ${vegetarianMealCount}）` : `盆栽 ${plantCount}、餐飲 ${mealCount}`} />}
                  <ReviewRow icon={<CreditCard />} label="付款" value={isFreeConfirmed ? "免費參訪（企業認養）" : "尚未開放付款"} />
                </div>
                {isFreeConfirmed ? (
                  <div className="price-box"><span>預約金額</span><strong>NT$ 0</strong><small>已確認企業認養免費參訪資格，這次參訪不收取門票費用。</small></div>
                ) : (
                  <div className="price-box"><span>預約金額</span><strong>NT$ {price.totalTwd.toLocaleString()}</strong><small>門票 NT$ {price.ticketUnitPriceTwd.toLocaleString()}／人，共 NT$ {price.ticketSubtotalTwd.toLocaleString()}；本次折抵 NT$ {price.creditAppliedTwd.toLocaleString()}。目前尚未開放付款。</small></div>
                )}
                {checkout.status === "idle" && isEligibilityBlocking && (
                  <div className="blocked-result"><ShieldCheck /><div><strong>免費參訪資格驗證尚未完成，無法送出</strong><p>請回上一步重新驗證，或明確選擇改為一般付費預約。</p><button type="button" className="secondary-button" onClick={() => setStep(3)}><ArrowLeft /> 回上一步處理</button></div></div>
                )}
                {checkout.status === "idle" && !isEligibilityBlocking && (
                  <button className="primary-button" onClick={submitBooking}>送出預約申請 <ArrowRight /></button>
                )}
                {checkout.status === "loading" && <button className="primary-button" disabled><LoaderCircle /> 正在保留名額…</button>}
                {checkout.status === "blocked" && <div className="blocked-result"><ShieldCheck /><div><strong>這次沒有建立預約</strong><p>{checkout.message}</p><span>沒有扣款。請回到時段重新選擇，或聯繫農場。</span></div></div>}
                {checkout.status === "reserved" && <>
                  <div className="blocked-result success-result"><Check /><div><strong>{checkout.message}</strong><p>預約編號：{checkout.bookingNumber}</p><span>查詢碼：<b>{checkout.lookupCode}</b>。請和手機號碼一起保存；目前沒有扣款。</span></div></div>
                  <OrderStatusBar bucket={checkout.statusBucket} />
                </>}
              </>
            )}
          </section>
        </>
      )}

      {view === "mine" && <MyBookingsView identity={lineIdentity} onBack={() => changeView("booking")} />}
      {view === "info" && <SimpleView icon={<Info />} title="交通與注意事項" intro="出發前先看開放時間、停車與場內安全提醒。"><div className="info-list"><InfoRow icon={<CalendarDays />} title="開放時間" text={<>週二、週三、週四 14:00–18:00 可直接預約。週五、週六、週日請先<a href="https://line.me/R/ti/p/@647hlrhw" target="_blank" rel="noreferrer">聯繫客服</a>討論並開放時段；假日時段門票加 20%。</>} /><InfoRow icon={<MapPin />} title="交通導航" text={<>請使用<a href="https://maps.app.goo.gl/mde8o1215UvvtbBu8" target="_blank" rel="noreferrer">Google Maps 農場導航</a>前往。</>} /><InfoRow icon={<Car />} title="停車" text="農場旁馬路邊可停車，請留意現場動線，不要阻擋出入口。" /><InfoRow icon={<CloudRain />} title="雨天安排" text="雨天活動照常；如遇豪雨或颱風，農場會另行通知取消。" /><InfoRow icon={<Footprints />} title="場內安全" text="進入場域會更換拖鞋。場內土地不是平整水泥地，嚴禁奔跑，請放慢腳步並小心行走。" /></div></SimpleView>}
      {view === "contact" && <SimpleView icon={<MessageCircle />} title="聯繫農場" intro="人數較多、沒有合適場次，或有特殊需求，可直接聯繫官方 LINE。"><a className="line-contact" href="https://line.me/R/ti/p/@647hlrhw" target="_blank" rel="noreferrer"><MessageCircle /><span><strong>開啟 WeGrow 官方 LINE</strong><small>@647hlrhw</small></span><ExternalLink /></a><a className="shop-link" href="https://wegrow.oen.tw/" target="_blank" rel="noreferrer">訂購當季鮮果 <ExternalLink /></a></SimpleView>}

      <nav className="app-bottom-nav" aria-label="主要功能">
        <NavButton active={view === "booking"} icon={<CalendarPlus />} label="預約參訪" onClick={() => changeView("booking")} />
        <NavButton active={view === "mine"} icon={<ReceiptText />} label="我的預約" onClick={() => changeView("mine")} />
        <NavButton active={view === "info"} icon={<MapPin />} label="交通須知" onClick={() => changeView("info")} />
        <NavButton active={view === "contact"} icon={<MessageCircle />} label="聯絡農場" onClick={() => changeView("contact")} />
      </nav>
    </main>
  );
}

function SectionHeading({ kicker, title, icon }: { kicker: string; title: string; icon: React.ReactNode }) { return <div className="section-heading"><div><span className="section-kicker">{kicker}</span><h2>{title}</h2></div>{icon}</div>; }
function Counter({ label, note, value, onMinus, onPlus }: { label: string; note: string; value: number; onMinus: () => void; onPlus: () => void }) { return <div className="counter"><span><strong>{label}</strong><small>{note}</small></span><div><button type="button" onClick={onMinus} aria-label={`${label}減少`}><Minus /></button><b>{value}</b><button type="button" onClick={onPlus} aria-label={`${label}增加`}><Plus /></button></div></div>; }
function BackButton({ onClick }: { onClick: () => void }) { return <button className="back-button" onClick={onClick}><ArrowLeft /> 上一步</button>; }
function ReviewRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) { return <div className="review-row"><span className="review-icon">{icon}</span><span><small>{label}</small><strong>{value}</strong></span><ChevronRight /></div>; }
function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) { return <button className={active ? "active" : ""} onClick={onClick}>{icon}<span>{label}</span></button>; }
function SimpleView({ icon, title, intro, children }: { icon: React.ReactNode; title: string; intro: string; children: React.ReactNode }) { return <section className="simple-view"><div className="simple-heading"><span>{icon}</span><div><h1>{title}</h1><p>{intro}</p></div></div>{children}</section>; }
function InfoRow({ icon, title, text }: { icon: React.ReactNode; title: string; text: React.ReactNode }) { return <div className="info-row"><span>{icon}</span><div><strong>{title}</strong><p>{text}</p></div></div>; }
function PriceLine({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) { return <div className={highlight ? "price-line highlight" : "price-line"}><span>{label}</span><strong>{value < 0 ? "−" : ""}NT$ {Math.abs(value).toLocaleString()}</strong></div>; }

// 規格 2A 節「訂單狀態列」：選日期→填資料→確認/付款→預約成立→已到場→已完成。
// stepIndexOf() is the single shared source of truth for where a booking sits
// (also used by the admin status buckets) so customer and staff views never disagree.
function OrderStatusBar({ bucket }: { bucket: StatusBucket }) {
  if (bucket === "cancelled") return <div className="order-status-bar cancelled"><Info /> 這筆預約已取消。</div>;
  const current = stepIndexOf(bucket);
  return (
    <div className="order-status-bar">
      {ORDER_STEPS.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <div key={label} className={`order-step ${state}`}>
            <span className="order-step-dot">{state === "done" ? <Check size={11} /> : index + 1}</span>
            <span className="order-step-label">{label}</span>
          </div>
        );
      })}
      {bucket === "exception" && <span className="order-step-note"><Info size={13} /> 需要農場確認，請留意 LINE 或電話通知。</span>}
    </div>
  );
}

function MyBookingsView({ identity, onBack }: { identity: LineIdentity; onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [message, setMessage] = useState("");
  const [booking, setBooking] = useState<BookingRecord | null>(null);
  const [mine, setMine] = useState<BookingRecord[]>([]);

  useEffect(() => {
    if (identity.status !== "ready") return;
    let cancelled = false;
    // No synchronous setState here (react-hooks/set-state-in-effect) — status
    // only resolves via .then()/.catch() below; nothing renders differently
    // for "idle" vs "loading" on this path.
    fetch("/api/farm/bookings?mine=1")
      .then(async (response) => {
        const result = await response.json() as { bookings?: BookingRecord[]; error?: string };
        if (!response.ok || !result.bookings) throw new Error(result.error || "無法讀取本人預約");
        if (!cancelled) {
          setMine(result.bookings);
          setStatus("ready");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(error instanceof Error ? error.message : "無法讀取本人預約");
          setStatus("error");
        }
      });
    return () => { cancelled = true; };
  }, [identity.status]);

  async function lookup() {
    setStatus("loading");
    setBooking(null);
    const query = new URLSearchParams({ phone: phone.replace(/\D/g, ""), code: code.trim() });
    try {
      const response = await fetch(`/api/farm/bookings?${query}`);
      const result = await response.json() as { booking?: BookingRecord; error?: string };
      if (!response.ok || !result.booking) {
        setMessage(result.error || "找不到符合的預約");
        setStatus("error");
        return;
      }
      setBooking(result.booking);
      setStatus("ready");
    } catch {
      setMessage("無法連接預約服務，請稍後再試。");
      setStatus("error");
    }
  }

  return <SimpleView icon={<ReceiptText />} title="我的預約" intro={identity.status === "ready" ? `已使用 LINE 登入：${identity.displayName}` : "用預約時填寫的手機號碼與 8 碼查詢碼查看進度。"}>
    <div className="booking-panel lookup-panel">
      {identity.status === "loading" && <div className="loading-state"><LoaderCircle /> 正在連結 LINE 身分…</div>}
      {identity.status === "ready" && status === "ready" && mine.length === 0 && <div className="empty-state">這個 LINE 帳號目前沒有預約。</div>}
      {identity.status === "ready" && mine.map((item) => <div className="review-block lookup-result" key={item.bookingNumber}>
        <ReviewRow icon={<ReceiptText />} label="預約編號" value={item.bookingNumber} />
        <ReviewRow icon={<CalendarDays />} label="日期" value={fullDate.format(new Date(item.startsAt))} />
        <ReviewRow icon={<Clock3 />} label="時間" value={`${timeOnly.format(new Date(item.startsAt))}–${timeOnly.format(new Date(item.endsAt))}`} />
        <ReviewRow icon={<Users />} label="人數" value={`${item.totalPeople} 位`} />
        <ReviewRow icon={<ShieldCheck />} label="預約狀態" value={item.bookingStatus === "requested" ? "等待農場確認" : item.bookingStatus} />
        <ReviewRow icon={<CreditCard />} label="付款狀態" value="尚未開放付款" />
        <OrderStatusBar bucket={item.statusBucket} />
      </div>)}
      {identity.status !== "ready" && <>
      <div className="form-grid">
        <label>手機號碼<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" placeholder="0912 345 678" /></label>
        <label>8 碼查詢碼<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} maxLength={8} placeholder="例：A1B2C3D4" /></label>
      </div>
      <button className="primary-button" disabled={!/^09\d{8}$/.test(phone.replace(/\D/g, "")) || code.trim().length !== 8 || status === "loading"} onClick={lookup}>
        {status === "loading" ? <><LoaderCircle /> 查詢中…</> : <>查詢預約 <ArrowRight /></>}
      </button>
      {status === "error" && <div className="blocked-result"><Info /><div><strong>查詢不到</strong><p>{message}</p></div></div>}
      {status === "ready" && booking && <div className="review-block lookup-result">
        <ReviewRow icon={<ReceiptText />} label="預約編號" value={booking.bookingNumber} />
        <ReviewRow icon={<CalendarDays />} label="日期" value={fullDate.format(new Date(booking.startsAt))} />
        <ReviewRow icon={<Clock3 />} label="時間" value={`${timeOnly.format(new Date(booking.startsAt))}–${timeOnly.format(new Date(booking.endsAt))}`} />
        <ReviewRow icon={<Users />} label="人數" value={`${booking.totalPeople} 位`} />
        <ReviewRow icon={<ShieldCheck />} label="預約狀態" value={booking.bookingStatus === "requested" ? "等待農場確認" : booking.bookingStatus} />
        <ReviewRow icon={<CreditCard />} label="付款狀態" value="尚未開放付款" />
        <OrderStatusBar bucket={booking.statusBucket} />
      </div>}
      </>}
      <button className="back-button" onClick={onBack}><ArrowLeft /> 返回預約</button>
    </div>
  </SimpleView>;
}
