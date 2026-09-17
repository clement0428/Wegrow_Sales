export const TICKET_PRICE_TWD = 300;
export const PLANT_PRICE_TWD = 250;
export const MEAL_PRICE_TWD = 350;

export type VisitPriceInput = {
  people: number;
  plantCount: number;
  mealCount: number;
  ticketRateBps?: number;
};

export function calculateVisitPrice({ people, plantCount, mealCount, ticketRateBps = 10_000 }: VisitPriceInput) {
  const ticketUnitPriceTwd = Math.round(TICKET_PRICE_TWD * Math.max(0, ticketRateBps) / 10_000);
  const ticketSubtotalTwd = Math.max(0, people) * ticketUnitPriceTwd;
  const addOnSubtotalTwd = Math.max(0, plantCount) * PLANT_PRICE_TWD + Math.max(0, mealCount) * MEAL_PRICE_TWD;
  const creditAppliedTwd = Math.min(ticketSubtotalTwd, addOnSubtotalTwd);

  return {
    ticketUnitPriceTwd,
    ticketSubtotalTwd,
    addOnSubtotalTwd,
    creditAppliedTwd,
    creditRemainingTwd: ticketSubtotalTwd - creditAppliedTwd,
    totalTwd: ticketSubtotalTwd + addOnSubtotalTwd - creditAppliedTwd,
  };
}
