import { listPublicSlots } from "@/lib/farm/repository";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const people = Number(url.searchParams.get("people") || "1");
  if (!Number.isInteger(people) || people < 1 || people > 50) {
    return Response.json({ error: "people 必須是 1 到 50 的整數" }, { status: 400 });
  }
  const slots = await listPublicSlots(people);
  return Response.json({
    mode: "live",
    source: "d1_farm_slots",
    published: true,
    notice: "場次與剩餘名額來自農場預約資料庫；週五、週六、週日請聯繫客服，付款尚未開放。",
    people,
    slots,
  });
}
