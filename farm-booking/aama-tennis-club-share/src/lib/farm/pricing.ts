export const TICKET_PRICE_TWD = 300;
export const PLANT_PRICE_TWD = 250;
export const MEAL_PRICE_TWD = 350;

export type VisitPriceInput = {
  people: number;
  plantCount: number;
  mealCount: number;
};

export function calculateVisitPrice({ people, plantCount, mealCount }: VisitPriceInput) {
  const ticketSubtotalTwd = Math.max(0, people) * TICKET_PRICE_TWD;
  const addOnSubtotalTwd = Math.max(0, plantCount) * PLANT_PRICE_TWD + Math.max(0, mealCount) * MEAL_PRICE_TWD;
  const creditAppliedTwd = Math.min(ticketSubtotalTwd, addOnSubtotalTwd);

  return {
    ticketSubtotalTwd,
    addOnSubtotalTwd,
    creditAppliedTwd,
    creditRemainingTwd: ticketSubtotalTwd - creditAppliedTwd,
    totalTwd: ticketSubtotalTwd + addOnSubtotalTwd - creditAppliedTwd,
  };
}
