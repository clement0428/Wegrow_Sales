export type RegRow = { member_id: string; seat_no: number; status: "confirmed" | "waitlisted" };

/** 給定既有座位號陣列，回下一位可用座位號（最大 + 1，空時為 1）。 */
export function nextSeatFrom(existing: number[]): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing) + 1;
}

/** 依 capacity 重算每筆的 status。回一個新陣列，不動原陣列。 */
export function recomputeStatus(rows: RegRow[], capacity: number): RegRow[] {
  return rows.map((r) => ({ ...r, status: r.seat_no <= capacity ? "confirmed" : "waitlisted" }));
}

/** 移除某人並把 seat_no 大於他的都往前收攏一位，再依 capacity 重算 status。
 * 回傳更新後陣列 + 「這次從 waitlisted 升為 confirmed」的成員 id（若沒有則 null）。 */
export function applyCancel(
  rows: RegRow[],
  memberId: string,
  capacity: number
): { after: RegRow[]; promoted: string | null } {
  const target = rows.find((r) => r.member_id === memberId);
  if (!target) throw new Error("找不到該成員");

  const before = new Map(rows.map((r) => [r.member_id, r.status]));

  const collapsed = rows
    .filter((r) => r.member_id !== memberId)
    .map((r) => ({ ...r, seat_no: r.seat_no > target.seat_no ? r.seat_no - 1 : r.seat_no }));

  const after = recomputeStatus(collapsed, capacity);

  let promoted: string | null = null;
  for (const r of after) {
    if (before.get(r.member_id) === "waitlisted" && r.status === "confirmed") {
      promoted = r.member_id;
      break;
    }
  }

  return { after, promoted };
}
