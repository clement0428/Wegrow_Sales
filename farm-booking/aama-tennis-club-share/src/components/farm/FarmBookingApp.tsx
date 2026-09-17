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

export type FarmView = "booking" | "mine" | "info" | "contact";

type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
  existingGroups: number[];
  maxNewGroupSize: number;
  available: boolean;
  experience: string;
  ticketRateBps: number;
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
  | { status: "reserved"; bookingNumber: string; lookupCode: string; message: string };

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
  const [lineIdentity, setLineIdentity] = useState<LineIdentity>({
    status: process.env.NEXT_PUBLIC_LIFF_ID ? "loading" : "disabled",
  });
  const idempotencyKey = useRef("");
  const people = adult + child + infant;

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
    setSlotId(null);
  }

  function changeView(next: FarmView) {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitBooking() {
    if (!selectedSlot) return;
    if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
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
          contactName,
          phone: phone.replace(/\D/g, ""),
          groupName,
          note,
          idempotencyKey: idempotencyKey.current,
        }),
      });
      const result = await response.json() as { booking?: BookingRecord; error?: string; message?: string };
      if (!response.ok || !result.booking) {
        setCheckout({ status: "blocked", message: result.error || "無法建立預約，請重新確認場次。" });
        return;
      }
      setCheckout({
        status: "reserved",
        bookingNumber: result.booking.bookingNumber,
        lookupCode: result.booking.lookupCode,
        message: result.message || "已收到預約申請。",
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
              <div className="intro-facts"><span><Clock3 /> 約 90 分鐘</span><span><Ticket /> 門票可折抵當日消費</span></div>
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
                <div className="ticket-card">
                  <span><Ticket /></span>
                  <div><strong>農場門票與導覽</strong><p>平日 NT$ {TICKET_PRICE_TWD}／人；假日時段 NT$ 360／人。門票金額可折抵參訪當日現場選購。</p></div>
                  <b>必選</b>
                </div>
                <h3 className="field-title">加選體驗</h3>
                <p className="section-help compact">先選數量，系統會把門票折抵金自動套用到本次選購。</p>
                <div className="counter-list addon-list">
                  <Counter label="盆栽手作" note={`NT$ ${PLANT_PRICE_TWD}／盆`} value={plantCount} onMinus={() => setPlantCount(Math.max(0, plantCount - 1))} onPlus={() => setPlantCount(Math.min(people, plantCount + 1))} />
                  <Counter label="現場餐飲" note={`NT$ ${MEAL_PRICE_TWD}／人`} value={mealCount} onMinus={() => setMealCount(Math.max(0, mealCount - 1))} onPlus={() => setMealCount(Math.min(people, mealCount + 1))} />
                </div>
                <div className="pricing-summary">
                  <PriceLine label={`門票 ${people} 人`} value={price.ticketSubtotalTwd} />
                  <PriceLine label="加選項目" value={price.addOnSubtotalTwd} />
                  <PriceLine label="本次門票折抵" value={-price.creditAppliedTwd} highlight />
                  <div className="pricing-total"><span>本次合計</span><strong>NT$ {price.totalTwd.toLocaleString()}</strong></div>
                  {price.creditRemainingTwd > 0 && <small>尚有 NT$ {price.creditRemainingTwd.toLocaleString()} 可於參訪當日折抵現場商品。</small>}
                </div>
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
                    <div className="date-pills">
                      {openDates.map((date) => <button key={date.key} className={activeDate === date.key ? "active" : ""} onClick={() => { setDateFilter(date.key); setSlotId(null); }}>{date.label}</button>)}
                    </div>
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
                <h3 className="field-title">付款方式（尚未開放）</h3>
                <div className="payment-options">
                  <button type="button" className="payment" disabled><MessageCircle /> LINE Pay <small>尚未開放付款</small></button>
                  <button type="button" className="payment" disabled><CreditCard /> 信用卡 <small>尚未開放付款</small></button>
                </div>
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
                  <ReviewRow icon={<ShoppingBasket />} label="加選" value={`盆栽 ${plantCount}、餐飲 ${mealCount}`} />
                  <ReviewRow icon={<CreditCard />} label="付款" value="尚未開放付款" />
                </div>
                <div className="price-box"><span>預約金額</span><strong>NT$ {price.totalTwd.toLocaleString()}</strong><small>門票 NT$ {price.ticketUnitPriceTwd.toLocaleString()}／人，共 NT$ {price.ticketSubtotalTwd.toLocaleString()}；本次折抵 NT$ {price.creditAppliedTwd.toLocaleString()}。目前尚未開放付款。</small></div>
                {checkout.status === "idle" && <button className="primary-button" onClick={submitBooking}>送出預約申請 <ArrowRight /></button>}
                {checkout.status === "loading" && <button className="primary-button" disabled><LoaderCircle /> 正在保留名額…</button>}
                {checkout.status === "blocked" && <div className="blocked-result"><ShieldCheck /><div><strong>這次沒有建立預約</strong><p>{checkout.message}</p><span>沒有扣款。請回到時段重新選擇，或聯繫農場。</span></div></div>}
                {checkout.status === "reserved" && <div className="blocked-result success-result"><Check /><div><strong>{checkout.message}</strong><p>預約編號：{checkout.bookingNumber}</p><span>查詢碼：<b>{checkout.lookupCode}</b>。請和手機號碼一起保存；目前沒有扣款。</span></div></div>}
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
    setStatus("loading");
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
      </div>}
      </>}
      <button className="back-button" onClick={onBack}><ArrowLeft /> 返回預約</button>
    </div>
  </SimpleView>;
}
