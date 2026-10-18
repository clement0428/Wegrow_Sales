import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { completeJobRun, startJobRun, type JobCounts } from "@/lib/outbox/job-run";
import { statusFor } from "@/lib/outbox/job-status";

type Row = Record<string, string | number | null>;
type Statement = { run(...params: unknown[]): { changes: number }; get(...params: unknown[]): Row | undefined; all(...params: unknown[]): Row[] };
type SQLite = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };
// Node 22+ ships SQLite; no extra package or production dependency is needed.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => SQLite };

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE farm_job_runs (
    id TEXT PRIMARY KEY, job_name TEXT NOT NULL, trigger_source TEXT NOT NULL,
    started_at TEXT NOT NULL, completed_at TEXT, due_count INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0, oldest_pending_seconds INTEGER, error_summary TEXT);
    CREATE INDEX idx_farm_job_runs_job_started ON farm_job_runs(job_name, started_at);
    CREATE TABLE farm_notification_outbox (status TEXT, next_attempt_at TEXT);
    CREATE TABLE farm_sales_sync_outbox (status TEXT, next_attempt_at TEXT);`);
  const writes: { sql: string; changed: number }[] = [];
  let beforeWrite: (() => Promise<void>) | undefined;
  const db = { prepare(sql: string) {
    let params: unknown[] = [];
    const query = {
      bind(...values: unknown[]) { params = values; return query; },
      async first() { return sqlite.prepare(sql).get(...params) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      async run() {
        if (beforeWrite) { const callback = beforeWrite; beforeWrite = undefined; await callback(); }
        const result = sqlite.prepare(sql).run(...params);
        writes.push({ sql, changed: result.changes });
        return { success: true, meta: { changes: result.changes } };
      },
    };
    return query;
  } } as unknown as D1Database;
  return { sqlite, db, writes, rows: () => sqlite.prepare("SELECT * FROM farm_job_runs ORDER BY id").all(), beforeWrite: (fn: () => Promise<void>) => { beforeWrite = fn; } };
}
const idle: JobCounts = { dueCount: 0, sent: 0, failed: 0, blocked: 0 };
const time = (value: string) => vi.setSystemTime(new Date(value));
let state: ReturnType<typeof database>;
beforeEach(() => {
  state = database();
  vi.useFakeTimers();
  time("2026-10-17T07:00:00.000Z");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { state.sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

async function finish(counts = idle, error: string | null = null, run = startJobRun("reminders", "cron")) {
  await completeJobRun(state.db, run, counts, null, error);
  return run;
}

describe("hourly job summaries (real SQLite statements)", () => {
  it("starts with a unique in-memory lease ID and no writes", () => {
    const a = startJobRun("reminders", "cron");
    const b = startJobRun("reminders", "cron");
    expect(a.id).not.toBe(b.id);
    expect(state.writes).toHaveLength(0);
    expect(state.rows()).toHaveLength(0);
  });

  it("two jobs polling every minute for 24 hours insert only 48 snapshots", async () => {
    for (let minute = 0; minute < 1440; minute++) {
      time(new Date(Date.UTC(2026, 9, 17, 0, minute)).toISOString());
      for (const job of ["reminders", "sales-sync"] as const) {
        await finish(idle, null, startJobRun(job, "cron"));
      }
    }
    expect(state.rows()).toHaveLength(48);
    expect(state.writes).toHaveLength(48);
    expect(state.writes.every((write) => write.changed === 1 && write.sql.startsWith("INSERT"))).toBe(true);
    expect(vi.mocked(console.info).mock.calls.filter(([message]) => String(message).includes("farm_job_completed"))).toHaveLength(2880);
    expect(vi.mocked(console.info).mock.calls.filter(([message]) => String(message).includes("farm_job_summary_persisted"))).toHaveLength(48);
  });

  it("two jobs polling every 15 minutes for 24 hours still insert only 48 snapshots", async () => {
    for (let minute = 0; minute < 1440; minute += 15) {
      time(new Date(Date.UTC(2026, 9, 17, 0, minute)).toISOString());
      for (const job of ["reminders", "sales-sync"] as const) {
        await finish(idle, null, startJobRun(job, "cron"));
      }
    }
    expect(state.rows()).toHaveLength(48);
    expect(state.writes).toHaveLength(48);
    expect(vi.mocked(console.info).mock.calls.filter(([message]) => String(message).includes("farm_job_completed"))).toHaveLength(192);
  });

  it("separates job, source and UTC hour and keeps idle snapshot time stable", async () => {
    await finish();
    time("2026-10-17T07:59:00.000Z");
    await finish();
    await finish(idle, null, startJobRun("reminders", "manual"));
    await finish(idle, null, startJobRun("madou-group", "cron"));
    time("2026-10-17T08:00:00.000Z");
    await finish();
    expect(state.rows()).toHaveLength(4);
    expect(state.rows().find((row) => row.id === "hourly:v1:reminders:cron:2026-10-17T07:00:00.000Z")?.completed_at).toBe("2026-10-17T07:00:00.000Z");
  });

  it("sums only actual outcomes and retains peak observed backlog", async () => {
    await Promise.all([
      finish({ dueCount: 50, sent: 3, failed: 2, blocked: 1 }),
      finish({ dueCount: 25, sent: 4, failed: 1, blocked: 2 }),
    ]);
    expect(state.rows()[0]).toMatchObject({ due_count: 50, sent_count: 7, failed_count: 3, blocked_count: 3 });
    const writes = state.writes.length;
    // Selected rows lost to a competing claimant are not work.
    await finish({ ...idle, dueCount: 50 });
    expect(state.writes).toHaveLength(writes);
  });

  it("does not write solely for growing backlog age", async () => {
    const run = startJobRun("reminders", "cron");
    await completeJobRun(state.db, run, idle, 10, null);
    time("2026-10-17T07:10:00.000Z");
    await completeJobRun(state.db, startJobRun("reminders", "cron"), idle, 610, null);
    expect(state.writes).toHaveLength(1);
  });

  it("records other durable changes, including stale cancels and digest/webhooks", async () => {
    await finish();
    time("2026-10-17T07:01:00.000Z");
    await finish({ ...idle, otherChanges: 1 });
    expect(state.writes).toHaveLength(2);
    expect(state.rows()[0]).toMatchObject({ completed_at: "2026-10-17T07:01:00.000Z", sent_count: 0 });
  });

  it("an empty insert racing active work cannot erase counters or errors", async () => {
    state.beforeWrite(() => finish({ dueCount: 1, sent: 0, failed: 1, blocked: 0 }, "credential:401").then(() => {}));
    await finish();
    expect(state.rows()).toHaveLength(1);
    expect(state.rows()[0]).toMatchObject({ failed_count: 1, error_summary: "credential:401" });
    expect(state.writes.map((row) => row.changed)).toEqual([1, 0]);
  });

  it("a new execution failure wins a race with an empty successful insert", async () => {
    state.beforeWrite(() => finish().then(() => {}));
    await finish(idle, "job_execution_failed");
    expect(state.rows()).toHaveLength(1);
    expect(state.rows()[0].error_summary).toBe("job_execution_failed");
  });

  it("a newer same-error observation wins when an older success clears it concurrently", async () => {
    await finish(idle, "job_execution_failed");
    time("2026-10-17T07:03:00.000Z");
    state.beforeWrite(async () => {
      time("2026-10-17T07:02:00.000Z");
      await finish({ ...idle, sent: 1 });
    });
    await finish({ ...idle, dueCount: 5 }, "job_execution_failed");
    expect(state.rows()[0]).toMatchObject({ error_summary: "job_execution_failed", completed_at: "2026-10-17T07:03:00.000Z", due_count: 5, sent_count: 1 });
  });

  it("non-send activity cannot pretend credential/config recovery", async () => {
    await finish({ ...idle, blocked: 1 }, "no_credentials,not_configured");
    time("2026-10-17T07:01:00.000Z");
    await finish({ ...idle, otherChanges: 1 });
    expect(state.rows()[0].error_summary).toBe("no_credentials,not_configured");
  });

  it("deduplicates repeated execution errors and records a subsequent recovery once", async () => {
    await finish(idle, "job_execution_failed");
    time("2026-10-17T07:01:00.000Z");
    await finish(idle, "job_execution_failed");
    expect(state.writes.reduce((sum, write) => sum + write.changed, 0)).toBe(1);
    await finish();
    await finish();
    expect(state.writes.reduce((sum, write) => sum + write.changed, 0)).toBe(2);
    expect(state.rows()[0].error_summary).toBe(null);
  });

  it("does not treat an empty poll as credential recovery", async () => {
    await finish({ ...idle, failed: 1 }, "credential:401");
    time("2026-10-17T07:01:00.000Z");
    await finish();
    expect(state.writes).toHaveLength(1);
    expect(state.rows()[0].error_summary).toBe("credential:401");
    await finish({ ...idle, sent: 1 });
    expect(state.rows()[0].error_summary).toBe(null);
  });

  it.each(["no_credentials_skipped_entirely", "not_configured_skipped_entirely", "no_group_id_skipped_entirely"])("normalizes %s and records explicit empty config recovery", async (code) => {
    await finish(idle, code);
    expect(state.rows()[0].error_summary).toBe(code.replace("_skipped_entirely", ""));
    time("2026-10-17T07:01:00.000Z");
    await finish({ ...idle, configReady: true });
    expect(state.rows()[0].error_summary).toBe(null);
    expect(state.writes.reduce((sum, write) => sum + write.changed, 0)).toBe(2);
    await finish({ ...idle, configReady: true });
    expect(state.writes).toHaveLength(2);
  });

  it("passing the config guard does not prove credential:401 recovery", async () => {
    await finish({ ...idle, failed: 1 }, "credential:401");
    time("2026-10-17T07:01:00.000Z");
    await finish({ ...idle, configReady: true });
    await finish({ ...idle, otherChanges: 1, configReady: true });
    expect(state.rows()[0].error_summary).toBe("credential:401");
  });

  it("never regresses snapshots or clears newer errors from an older overlapping run", async () => {
    const earlier = startJobRun("reminders", "cron");
    time("2026-10-17T07:02:00.000Z");
    await finish({ ...idle, failed: 1 }, "credential:401");
    time("2026-10-17T07:03:00.000Z");
    await finish({ ...idle, sent: 1 }, null, earlier);
    expect(state.rows()[0]).toMatchObject({ sent_count: 1, failed_count: 1, error_summary: "credential:401", completed_at: "2026-10-17T07:03:00.000Z" });
    time("2026-10-17T07:01:00.000Z");
    await finish({ ...idle, sent: 1 }, "transient:503", earlier);
    expect(state.rows()[0]).toMatchObject({ sent_count: 2, failed_count: 1, error_summary: "credential:401", completed_at: "2026-10-17T07:03:00.000Z" });
  });

  it("compare-and-set recovery cannot erase a failure written after its read", async () => {
    await finish(idle, "job_execution_failed");
    time("2026-10-17T07:01:00.000Z");
    state.beforeWrite(async () => {
      time("2026-10-17T07:02:00.000Z");
      await finish({ ...idle, failed: 1 }, "credential:401");
    });
    await finish();
    expect(state.rows()[0].error_summary).toBe("credential:401");
  });

  it("sanitizes and bounds errors, and summary failure never rejects business completion", async () => {
    await finish({ ...idle, failed: 1 }, "credential:401,credential:401,customer phone 123 secret=abc");
    expect(state.rows()[0].error_summary).toBe("credential:401,job_execution_failed");
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain("secret");
    state.sqlite.exec("DROP TABLE farm_job_runs");
    await expect(finish({ ...idle, sent: 1 })).resolves.toBeDefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("summary_persistence_failed"));
  });
});

describe("hourly status semantics", () => {
  it("manual records cannot conceal missing cron and legacy rows are distinguished", async () => {
    for (let index = 0; index < 12; index++) {
      state.sqlite.prepare("INSERT INTO farm_job_runs (id, job_name, trigger_source, started_at, completed_at) VALUES (?, 'reminders', 'manual', ?, ?)")
        .run(`legacy-${index}`, `2026-10-17T07:${String(index).padStart(2, "0")}:00.000Z`, "2026-10-17T07:15:00.000Z");
    }
    await finish(idle, null, startJobRun("reminders", "manual"));
    const status = await statusFor(state.db, "reminders", "farm_notification_outbox");
    expect(status.lastCronObservedAt).toBe(null);
    expect(status.alerts.heartbeatMissed).toBe(true);
    expect(status.recentRuns.some((row) => row.recordKind === "legacy_run")).toBe(true);
    expect(status.alerts.thresholds.heartbeatMissedMinutes).toBe(75);
  });

  it.each(["not_configured", "no_group_id", "no_credentials"])("surfaces %s separately from execution failure", async (code) => {
    await finish(idle, code);
    const status = await statusFor(state.db, "reminders", "farm_notification_outbox");
    expect(status.alerts.hasCredentialErrors).toBe(true);
    expect(status.alerts.hasExecutionErrors).toBe(false);
  });

  it("unexpected failures remain visible even when completed cron evidence is fresh", async () => {
    await finish(idle, "job_execution_failed");
    for (let index = 0; index < 12; index++) {
      state.sqlite.prepare("INSERT INTO farm_job_runs (id, job_name, trigger_source, started_at, completed_at) VALUES (?, 'reminders', 'manual', ?, ?)")
        .run(`manual-${index}`, "2026-10-17T07:30:00.000Z", "2026-10-17T07:30:00.000Z");
    }
    const status = await statusFor(state.db, "reminders", "farm_notification_outbox");
    expect(status.alerts.heartbeatMissed).toBe(false);
    expect(status.alerts.hasExecutionErrors).toBe(true);
  });

  it("keeps a newer summary completion visible beside legacy rows from the same hour", async () => {
    time("2026-10-17T07:45:00.000Z");
    await finish();
    state.sqlite.prepare("INSERT INTO farm_job_runs (id, job_name, trigger_source, started_at, completed_at) VALUES ('legacy', 'reminders', 'cron', ?, ?)")
      .run("2026-10-17T07:30:00.000Z", "2026-10-17T07:31:00.000Z");
    const status = await statusFor(state.db, "reminders", "farm_notification_outbox");
    expect(status.lastCronObservedAt).toBe("2026-10-17T07:45:00.000Z");
  });

  it("uses completed cron evidence with 75-minute allowance and unchanged backlog threshold", async () => {
    await finish();
    state.sqlite.prepare("INSERT INTO farm_notification_outbox (status, next_attempt_at) VALUES ('queued', ?)").run("2026-10-17T06:00:00.000Z");
    time("2026-10-17T08:14:00.000Z");
    await finish(idle, null, startJobRun("reminders", "manual"));
    let status = await statusFor(state.db, "reminders", "farm_notification_outbox");
    expect(status.alerts.heartbeatMissed).toBe(false);
    expect(status.alerts.backlogTooOld).toBe(true);
    expect(status.alerts.thresholds.backlogTooOldSeconds).toBe(600);
    expect(status.recentRuns[0].recordKind).toBe("hourly_summary");
    time("2026-10-17T08:16:00.000Z");
    status = await statusFor(state.db, "reminders", "farm_notification_outbox");
    expect(status.alerts.heartbeatMissed).toBe(true);
  });
});
