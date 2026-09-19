// 應收／累計收款／累計退款／淨收款／未收：定義寫清楚，不含糊。
// amountDue          原始快照（歷史事實，不因取消而改寫）。
// amountReceived     累計收款（record_type='payment' 加總）。
// amountRefunded     累計退款（record_type='refund' 加總）。
// netReceived        淨收款 = amountReceived - amountRefunded。
// amountOutstanding  未收（可為負，代表超收）＝ amountDue - netReceived。
// overpaidAmount     超收金額 = max(0, -amountOutstanding)；不用負的「未收」表示超收。
// trueOutstanding    真正還欠多少 = max(0, amountOutstanding)。
// bookingCancelled/adjustedAmountDue：取消後「應收」在使用者介面上該顯示 0，
// 但這是顯示層調整，不是自動退款——退款永遠要管理員手動另外登記一筆。
// Extracted as a pure function (no DB) so the boundary cases below are
// directly unit-testable.
export type PaymentRecordLike = { recordType: "payment" | "refund"; amountTwd: number };

export function computePaymentSummary(amountDue: number, bookingCancelled: boolean, records: PaymentRecordLike[]) {
  const amountReceived = records.filter((r) => r.recordType === "payment").reduce((sum, r) => sum + r.amountTwd, 0);
  const amountRefunded = records.filter((r) => r.recordType === "refund").reduce((sum, r) => sum + r.amountTwd, 0);
  const netReceived = amountReceived - amountRefunded;
  const amountOutstanding = amountDue - netReceived;
  return {
    amountDue,
    bookingCancelled,
    adjustedAmountDue: bookingCancelled ? 0 : amountDue,
    amountReceived,
    amountRefunded,
    netReceived,
    amountOutstanding,
    overpaidAmount: Math.max(0, -amountOutstanding),
    trueOutstanding: Math.max(0, amountOutstanding),
    refundableAmount: Math.max(0, netReceived),
  };
}
