import "server-only";
import { getDb } from "@/lib/db/client";
import { maxNewGroupSize, type CapacityPolicy } from "./capacity";
import { isAllowedBookingSlot, ticketRateBpsForSlot } from "./visit-policy";

export type PublicFarmSlot = {
  id: string; startsAt: string; endsAt: string; existingGroups: number[];
  maxNewGroupSize: number; available: boolean; experience: string;
  ticketRateBps: number;
};

type SlotRow = {
  id: string; starts_at: string; ends_at: string; experience: string;
  max_groups: number; limit_one_group: number; limit_two_groups: number;
  limit_three_groups: number; group_sizes: string | null;
};

function rowPolicy(row: SlotRow): CapacityPolicy {
  return {
    maxGroups: row.max_groups,
    totalLimitByGroupCount: {
      1: row.limit_one_group, 2: row.limit_two_groups, 3: row.limit_three_groups,
    },
  };
}

export async function listPublicSlots(people: number): Promise<PublicFarmSlot[]> {
  const db = await getDb();
  const now = new Date().toISOString();
  const result = await db.prepare(`
    SELECT s.id, s.starts_at, s.ends_at, e.name AS experience,
           p.max_groups, p.limit_one_group, p.limit_two_groups, p.limit_three_groups,
           GROUP_CONCAT(CASE
             WHEN b.booking_status IN ('requested','confirmed') THEN b.total_people
             WHEN b.booking_status = 'pending_payment' AND datetime(b.hold_expires_at) > datetime(?) THEN b.total_people
             ELSE NULL END) AS group_sizes
    FROM farm_slots s
    JOIN farm_experiences e ON e.id = s.experience_id AND e.active = 1
    JOIN farm_capacity_policies p ON p.id = s.capacity_policy_id
    LEFT JOIN farm_bookings b ON b.slot_id = s.id
    WHERE s.status = 'open'
      AND datetime(s.starts_at) > datetime(?)
      AND datetime(s.booking_cutoff_at) > datetime(?)
    GROUP BY s.id
    ORDER BY datetime(s.starts_at)
  `).bind(now, now, now).all<SlotRow>();

  return (result.results ?? []).filter((row) => isAllowedBookingSlot(row.starts_at, row.ends_at)).map((row) => {
    const existingGroups = row.group_sizes
      ? row.group_sizes.split(",").map(Number).filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const maximum = maxNewGroupSize(existingGroups, rowPolicy(row));
    return {
      id: row.id, startsAt: row.starts_at, endsAt: row.ends_at, existingGroups,
      maxNewGroupSize: maximum, available: maximum >= people, experience: row.experience,
      ticketRateBps: ticketRateBpsForSlot(row.starts_at),
    };
  });
}

export type FarmBookingRecord = {
  bookingNumber: string; lookupCode: string; contactName: string; contactPhone: string;
  groupName: string; adultCount: number; childCount: number; infantCount: number;
  totalPeople: number; plantCount: number; mealCount: number; amountTwd: number;
  bookingStatus: string; paymentStatus: string; startsAt: string; endsAt: string;
  experience: string; createdAt: string;
};

type BookingRow = {
  booking_number: string; lookup_code: string; contact_name: string; contact_phone: string;
  group_name: string | null; adult_count: number; child_count: number; infant_count: number;
  total_people: number; plant_count: number; meal_count: number; amount_twd: number;
  booking_status: string; payment_status: string; starts_at: string; ends_at: string;
  experience: string; created_at: string;
};

function mapBooking(row: BookingRow): FarmBookingRecord {
  return {
    bookingNumber: row.booking_number, lookupCode: row.lookup_code,
    contactName: row.contact_name, contactPhone: row.contact_phone,
    groupName: row.group_name ?? "", adultCount: row.adult_count,
    childCount: row.child_count, infantCount: row.infant_count,
    totalPeople: row.total_people, plantCount: row.plant_count, mealCount: row.meal_count,
    amountTwd: row.amount_twd, bookingStatus: row.booking_status,
    paymentStatus: row.payment_status, startsAt: row.starts_at, endsAt: row.ends_at,
    experience: row.experience, createdAt: row.created_at,
  };
}

export async function findBooking(phone: string, lookupCode: string): Promise<FarmBookingRecord | null> {
  const db = await getDb();
  const row = await db.prepare(`
    SELECT b.booking_number, b.lookup_code, b.contact_name, b.contact_phone, b.group_name,
           b.adult_count, b.child_count, b.infant_count, b.total_people,
           b.plant_count, b.meal_count, b.amount_twd, b.booking_status,
           b.payment_status, b.created_at, s.starts_at, s.ends_at, e.name AS experience
    FROM farm_bookings b
    JOIN farm_slots s ON s.id = b.slot_id
    JOIN farm_experiences e ON e.id = s.experience_id
    WHERE b.contact_phone = ? AND UPPER(b.lookup_code) = UPPER(?)
    LIMIT 1
  `).bind(phone, lookupCode).first<BookingRow>();
  return row ? mapBooking(row) : null;
}

export async function listMemberBookings(memberId: string): Promise<FarmBookingRecord[]> {
  const db = await getDb();
  const result = await db.prepare(`
    SELECT b.booking_number, b.lookup_code, b.contact_name, b.contact_phone, b.group_name,
           b.adult_count, b.child_count, b.infant_count, b.total_people,
           b.plant_count, b.meal_count, b.amount_twd, b.booking_status,
           b.payment_status, b.created_at, s.starts_at, s.ends_at, e.name AS experience
    FROM farm_bookings b
    JOIN farm_slots s ON s.id = b.slot_id
    JOIN farm_experiences e ON e.id = s.experience_id
    WHERE b.customer_member_id = ? AND b.cancelled_at IS NULL
    ORDER BY datetime(s.starts_at) DESC
  `).bind(memberId).all<BookingRow>();
  return (result.results ?? []).map(mapBooking);
}
