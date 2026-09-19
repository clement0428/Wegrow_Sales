import "server-only";

// Lease duration: long enough to cover a network call + a few D1 writes,
// short enough that a crashed/killed invocation doesn't block the row for
// long. Matches spec: "過期claim／執行中crash不得永久卡住或重複扣容量"（here:
// 不得重複發送/重複同步，not capacity, but same principle）.
export const LEASE_MINUTES = 2;

// Atomically claim one outbox row: only succeeds if it's still queued AND
// either never leased or its lease has expired. Returns true if this call
// won the claim — callers must skip the row if it returns false (another
// concurrent invocation got there first).
export async function claimRow(db: D1Database, table: "farm_notification_outbox" | "farm_sales_sync_outbox", rowId: string, leaseOwner: string): Promise<boolean> {
  const now = new Date().toISOString();
  const leaseUntil = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE ${table}
       SET leased_until = ?, leased_by = ?
       WHERE id = ? AND status = 'queued' AND (leased_until IS NULL OR leased_until < ?)`,
    )
    .bind(leaseUntil, leaseOwner, rowId, now)
    .run();
  return result.meta.changes > 0;
}
