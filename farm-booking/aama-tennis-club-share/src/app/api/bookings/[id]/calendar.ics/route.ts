import { buildFarmCalendar } from "@/lib/farm/calendar";

export async function GET(_request: Request, context: RouteContext<"/api/bookings/[id]/calendar.ics">) {
  const { id } = await context.params;
  const body = buildFarmCalendar({
    bookingId: id,
    startsAt: "2026-09-19T09:30:00",
    endsAt: "2026-09-19T11:00:00",
    summary: "WeGrow 科技農場參訪",
    location: "台南麻豆 WeGrow 科技農場",
    description: "請穿著方便行走的鞋子，攜帶飲水並留意行前通知。",
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="wegrow-${id}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
