export const BOOKING_STATES = [
  "held", "payment_review", "confirmed", "change_requested", "cancel_requested",
  "cancelled", "expired", "checked_in", "completed", "no_show",
] as const;

export const PAYMENT_STATES = [
  "unpaid", "pending", "paid", "failed", "refund_pending", "partially_refunded", "refunded",
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];
export type PaymentState = (typeof PAYMENT_STATES)[number];

const bookingTransitions: Record<BookingState, BookingState[]> = {
  held: ["payment_review", "confirmed", "cancelled", "expired"],
  payment_review: ["confirmed", "cancelled", "expired"],
  confirmed: ["change_requested", "cancel_requested", "checked_in", "no_show"],
  change_requested: ["confirmed", "cancel_requested", "cancelled"],
  cancel_requested: ["confirmed", "cancelled"],
  cancelled: [],
  expired: [],
  checked_in: ["completed"],
  completed: [],
  no_show: [],
};

export function canTransitionBooking(from: BookingState, to: BookingState): boolean {
  return bookingTransitions[from].includes(to);
}

export function occupiesCapacity(booking: BookingState, payment: PaymentState): boolean {
  if (["cancelled", "expired"].includes(booking)) return false;
  return ["held", "payment_review", "confirmed", "change_requested", "cancel_requested", "checked_in"].includes(booking)
    || payment === "paid";
}
