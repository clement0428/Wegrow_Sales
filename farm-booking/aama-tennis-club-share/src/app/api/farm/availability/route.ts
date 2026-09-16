import { maxNewGroupSize } from "@/lib/farm/capacity";

const previewSlots = [
  { id: "S-0919-AM", startsAt: "2026-09-19T09:30:00+08:00", endsAt: "2026-09-19T11:00:00+08:00", existingGroups: [], experience: "科技溫室參訪" },
  { id: "S-0919-PM", startsAt: "2026-09-19T14:00:00+08:00", endsAt: "2026-09-19T15:30:00+08:00", existingGroups: [20], experience: "科技溫室參訪" },
  { id: "S-0920-AM", startsAt: "2026-09-20T09:30:00+08:00", endsAt: "2026-09-20T11:00:00+08:00", existingGroups: [5, 5], experience: "科技溫室參訪" },
  { id: "S-0926-AM", startsAt: "2026-09-26T10:00:00+08:00", endsAt: "2026-09-26T11:30:00+08:00", existingGroups: [], experience: "農夫導覽與果況觀察" },
];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const people = Number(url.searchParams.get("people") || "1");
  if (!Number.isInteger(people) || people < 1 || people > 50) {
    return Response.json({ error: "people 必須是 1 到 50 的整數" }, { status: 400 });
  }
  return Response.json({
    mode: "preview",
    source: "preview_seed",
    published: false,
    notice: "預覽資料，待農場在管理後台核准後才能公開",
    people,
    slots: previewSlots.map((slot) => ({
      ...slot,
      maxNewGroupSize: maxNewGroupSize(slot.existingGroups),
      available: maxNewGroupSize(slot.existingGroups) >= people,
    })),
  });
}
