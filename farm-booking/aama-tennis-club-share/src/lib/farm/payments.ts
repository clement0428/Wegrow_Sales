export type PaymentMethod = "line_pay" | "credit_card";

export type CheckoutResult = {
  redirectUrl: string;
  transactionId: string;
  mode: "sandbox" | "production";
};

export type VerifiedPaymentEvent = {
  providerEventId: string;
  transactionId: string;
  orderId: string;
  amount: number;
  currency: "TWD";
  status: "paid" | "failed" | "pending";
};

export interface PaymentProvider {
  readonly method: PaymentMethod;
  readonly mode: "sandbox" | "production";
  createCheckout(orderId: string, attemptId: string, amount: number): Promise<CheckoutResult>;
  verifyAndParseCallback(rawBody: Uint8Array, headers: Headers): Promise<VerifiedPaymentEvent>;
  queryPayment(transactionId: string): Promise<VerifiedPaymentEvent>;
  refund(transactionId: string, amount: number, idempotencyKey: string): Promise<{ refundId: string; status: "pending" | "refunded" }>;
}

export class NotConfiguredPaymentProvider implements PaymentProvider {
  readonly mode = "sandbox" as const;
  constructor(readonly method: PaymentMethod) {}
  private fail(): never {
    throw new Error(`${this.method} 尚未設定商家 sandbox，沒有建立付款或扣款`);
  }
  async createCheckout(orderId: string, attemptId: string, amount: number): Promise<CheckoutResult> {
    void [orderId, attemptId, amount];
    return this.fail();
  }
  async verifyAndParseCallback(rawBody: Uint8Array, headers: Headers): Promise<VerifiedPaymentEvent> {
    void [rawBody, headers];
    return this.fail();
  }
  async queryPayment(transactionId: string): Promise<VerifiedPaymentEvent> {
    void transactionId;
    return this.fail();
  }
  async refund(transactionId: string, amount: number, idempotencyKey: string): Promise<{ refundId: string; status: "pending" | "refunded" }> {
    void [transactionId, amount, idempotencyKey];
    return this.fail();
  }
}

export function assertPaymentMatchesOrder(
  event: VerifiedPaymentEvent,
  order: { id: string; amount: number; currency: "TWD" },
): void {
  if (event.orderId !== order.id || event.amount !== order.amount || event.currency !== order.currency) {
    throw new Error("付款回調與訂單金額或幣別不一致");
  }
}
