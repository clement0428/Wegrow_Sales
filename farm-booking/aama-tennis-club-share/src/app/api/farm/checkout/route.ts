import { z } from "zod";
import { NotConfiguredPaymentProvider } from "@/lib/farm/payments";

const checkoutSchema = z.object({
  bookingId: z.string().min(1),
  attemptId: z.string().min(1),
  amount: z.number().int().positive(),
  method: z.enum(["line_pay", "credit_card"]),
  contact: z.object({
    contactName: z.string().trim().min(1),
    phone: z.string().regex(/^09\d{8}$/),
    groupName: z.string().max(100),
    note: z.string().max(1000),
  }),
});

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "結帳資料不完整", issues: parsed.error.issues }, { status: 400 });
  }
  const provider = new NotConfiguredPaymentProvider(parsed.data.method);
  try {
    return Response.json(await provider.createCheckout(parsed.data.bookingId, parsed.data.attemptId, parsed.data.amount));
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "付款服務尚未設定",
      code: "payment_provider_not_configured",
      charged: false,
    }, { status: 503 });
  }
}
