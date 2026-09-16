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
