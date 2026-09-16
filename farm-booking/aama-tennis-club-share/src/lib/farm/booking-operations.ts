import { canFit } from "@/lib/farm/capacity";
import { reminderAtForVisit, reminderDedupeKey } from "@/lib/farm/reminders";

export type BookingRecord = {
  id: string;
  people: number;
  status: "held" | "confirmed" | "cancelled";
  visitVersion: number;
};

export type SalesBookingEvent = {
  eventId: string;
  source: "wegrow_farm_booking";
  bookingId: string;
  eventType: "booking.held" | "booking.confirmed" | "booking.cancelled";
  version: number;
  occurredAt: string;
};

export class AtomicBookingLedger {
  private bookings = new Map<string, BookingRecord>();
  private salesEvents = new Map<string, SalesBookingEvent>();
  private queue = Promise.resolve();

  reserve(id: string, people: number, occurredAt = new Date().toISOString()): Promise<{ accepted: boolean; reason: string }> {
    return this.serial(async () => {
      if (this.bookings.has(id)) return { accepted: false, reason: "duplicate_booking" };
      const activeGroups = this.activeBookings().map((booking) => booking.people);
      if (!canFit(activeGroups, people)) return { accepted: false, reason: "capacity_exceeded" };

      const booking: BookingRecord = { id, people, status: "held", visitVersion: 1 };
      this.bookings.set(id, booking);
      this.recordSalesEvent(booking, "booking.held", occurredAt);
      return { accepted: true, reason: "held" };
    });
  }

  confirm(id: string, occurredAt = new Date().toISOString()): Promise<boolean> {
    return this.serial(async () => {
      const booking = this.bookings.get(id);
      if (!booking || booking.status !== "held") return false;
      booking.status = "confirmed";
      this.recordSalesEvent(booking, "booking.confirmed", occurredAt);
      return true;
    });
  }

  cancel(id: string, occurredAt = new Date().toISOString()): Promise<boolean> {
    return this.serial(async () => {
      const booking = this.bookings.get(id);
      if (!booking || booking.status === "cancelled") return false;
      booking.status = "cancelled";
      booking.visitVersion += 1;
      this.recordSalesEvent(booking, "booking.cancelled", occurredAt);
      return true;
    });
  }

  reminderFor(id: string, visitStartIso: string) {
    const booking = this.bookings.get(id);
    if (!booking || booking.status !== "confirmed") return null;
    return {
      scheduledAt: reminderAtForVisit(visitStartIso).toISOString(),
      retryKey: reminderDedupeKey(booking.id, booking.visitVersion),
    };
  }

  activeBookings(): BookingRecord[] {
    return [...this.bookings.values()].filter((booking) => booking.status !== "cancelled");
  }

  getSalesEvents(): SalesBookingEvent[] {
    return [...this.salesEvents.values()];
  }

  private recordSalesEvent(booking: BookingRecord, eventType: SalesBookingEvent["eventType"], occurredAt: string) {
    const eventId = `${booking.id}:${booking.visitVersion}:${eventType}`;
    this.salesEvents.set(eventId, {
      eventId,
      source: "wegrow_farm_booking",
      bookingId: booking.id,
      eventType,
      version: booking.visitVersion,
      occurredAt,
    });
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
