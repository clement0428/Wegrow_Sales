import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    LINE_MESSAGING_ACCESS_TOKEN: "test-line-token",
    MADOU_GROUP_ID: "test-group",
    SALES_SYNC_API_URL: "https://sales.invalid/sync",
    SALES_SYNC_API_KEY: "test-sync-key",
  },
  getDb: vi.fn(),
  claimRow: vi.fn(),
  sendLinePushMessage: vi.fn(),
  sendSalesSync: vi.fn(),
  queueDailyDigestIfDue: vi.fn(),
  reconcileMissingWorkCards: vi.fn(),
  buildQueueMadouWebhookResultStatement: vi.fn(),
  processMadouPostbackAction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/env", () => ({ env: mocks.env }));
vi.mock("@/lib/outbox/claim", () => ({ claimRow: mocks.claimRow }));
vi.mock("@/lib/line/messaging", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/line/messaging")>(),
  sendLinePushMessage: mocks.sendLinePushMessage,
}));
vi.mock("@/lib/sales/sync-client", () => ({ sendSalesSync: mocks.sendSalesSync }));
vi.mock("@/lib/line/madou-group-queue", () => ({
  queueDailyDigestIfDue: mocks.queueDailyDigestIfDue,
  buildQueueMadouWebhookResultStatement: mocks.buildQueueMadouWebhookResultStatement,
}));
vi.mock("@/lib/farm/booking-side-effects", () => ({ reconcileMissingWorkCards: mocks.reconcileMissingWorkCards }));
vi.mock("@/lib/line/madou-webhook-process", () => ({
  processMadouPostbackAction: mocks.processMadouPostbackAction,
}));

// Keep the real job-run helper: these tests exercise route -> hourly-summary
// integration, while every business I/O boundary and all D1 access are local.
import { POST as reminders } from "@/app/api/jobs/reminders/route";
import { POST as salesSync } from "@/app/api/jobs/sales-sync/route";
import { POST as madouGroup } from "@/app/api/jobs/madou-group/route";
import { MAX_SEND_ATTEMPTS } from "@/lib/outbox/backoff";
import { HOURLY_JOB_RUN_PREFIX } from "@/lib/outbox/job-run";

type Row = Record<string, unknown>;
type JobResponse = Row & { runId: string };
type ExecutedStatement = { sql: string; values: unknown[]; method: "all" | "first" | "run" };
type MockStatement = {
  sql: string;
  values: unknown[];
  bind: (...values: unknown[]) => MockStatement;
  all: () => Promise<{ results: Row[] }>;
  first: () => Promise<Row | null>;
  run: () => Promise<{ success: boolean; meta: { changes: number } }>;
};

function createDb(options: {
  outboxRows?: Row[];
  retryRows?: Row[];
  member?: Row | null;
  bookingState?: Row | null;
  summaryReadFails?: boolean;
  summaryWriteFails?: boolean;
} = {}) {
  const executed: ExecutedStatement[] = [];
  const batches: MockStatement[][] = [];
  const database = {
    prepare(sqlText: string): MockStatement {
      const sql = sqlText.replace(/\s+/g, " ").trim();
      const statement: MockStatement = {
        sql,
        values: [],
        bind(...values) { statement.values = values; return statement; },
        async all() {
          executed.push({ sql, values: statement.values, method: "all" });
          if (sql.includes("FROM farm_line_webhook_events")) return { results: options.retryRows ?? [] };
          if (sql.includes("FROM farm_notification_outbox") || sql.includes("FROM farm_sales_sync_outbox")) {
            return { results: options.outboxRows ?? [] };
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
        async first() {
          executed.push({ sql, values: statement.values, method: "first" });
          if (sql.includes("FROM farm_job_runs")) {
            if (options.summaryReadFails) throw new Error("test summary read failure");
            // An idle invocation in an already-recorded hour must not write.
            return { completed_at: "2026-10-17T07:00:00.000Z", error_summary: null };
          }
          if (sql.startsWith("SELECT MIN(")) return { oldest: null };
          if (sql.includes("FROM members")) {
            return options.member === undefined ? { id: "staff-1", display_name: "Test staff", role: "admin" } : options.member;
          }
          if (sql.includes("FROM farm_bookings")) return options.bookingState ?? null;
          throw new Error(`Unexpected first query: ${sql}`);
        },
        async run() {
          executed.push({ sql, values: statement.values, method: "run" });
          if (sql.includes("farm_job_runs") && options.summaryWriteFails) throw new Error("test summary write failure");
          return { success: true, meta: { changes: 1 } };
        },
      };
      return statement;
    },
    async batch(statements: MockStatement[]) {
      batches.push(statements);
      return statements.map(() => ({ success: true, meta: { changes: 1 } }));
    },
  };
  const db = database as unknown as D1Database;
  mocks.getDb.mockResolvedValue(db);
  return {
    db,
    executed,
    batches,
    writes: () => executed.filter((statement) => statement.method === "run"),
    summaryWrites: () => executed.filter((statement) => statement.method === "run" && statement.sql.includes("farm_job_runs")),
  };
}

const reminderRow = {
  id: "reminder-1", booking_id: "booking-1", recipient_id: "member-1", attempt_count: 0,
  cancelled_at: null, line_user_id: "test-line-user", experience: "Test visit",
  starts_at: "2026-10-18T01:00:00.000Z", ends_at: "2026-10-18T03:00:00.000Z", booking_number: "TEST-1",
};
const salesRow = {
  id: "sales-1", booking_id: "booking-1", event_type: "booking_confirmed", attempt_count: 0,
  created_at: "2026-10-17T06:00:00.000Z", booking_number: "TEST-1", booking_version: 1,
  contact_name: "Test visitor", contact_phone: "test-phone", group_name: null, total_people: 2,
  starts_at: "2026-10-18T01:00:00.000Z", experience: "Test visit",
};
const groupRow = {
  id: "group-1", booking_id: null, notification_type: "madou_daily_digest",
  content_snapshot_json: JSON.stringify({ targetDate: "2026-10-18", text: "Test digest" }), attempt_count: 0,
};
const retryRow = {
  id: "webhook-1", action: "claim", booking_id: "booking-1", actor_member_id: "staff-1",
  visit_version_param: 1, attempt_count: 0,
};
const supersededRow = {
  ...groupRow, id: "card-1", booking_id: "booking-1", notification_type: "madou_work_card_event",
  content_snapshot_json: JSON.stringify({ eventKind: "confirmed", visitVersion: 1, booking: { bookingId: "booking-1" } }),
};
const pendingRow = {
  ...supersededRow,
  id: "pending-card-1",
  content_snapshot_json: JSON.stringify({
    eventKind: "pending", visitVersion: 1,
    booking: {
      bookingId: "booking-1", bookingNumber: "TEST-1", groupName: null, experience: "Test visit",
      startsAt: "2026-10-18T01:00:00.000Z", endsAt: "2026-10-18T03:00:00.000Z",
      adultCount: 2, childCount: 0, infantCount: 0, totalPeople: 2,
      plantCount: 0, mealCount: 0, vegetarianMealCount: 0,
    },
  }),
};

const routes = [
  { name: "reminders", post: reminders, row: reminderRow, table: "farm_notification_outbox", send: mocks.sendLinePushMessage },
  { name: "sales-sync", post: salesSync, row: salesRow, table: "farm_sales_sync_outbox", send: mocks.sendSalesSync },
  { name: "madou-group", post: madouGroup, row: groupRow, table: "farm_notification_outbox", send: mocks.sendLinePushMessage },
];

function request(source: "cron" | "manual" = "cron") {
  return new Request("https://jobs.invalid/local-test", {
    method: "POST", headers: { authorization: "Bearer test-job-secret", "x-trigger-source": source },
  });
}

function completionEvents() {
  return vi.mocked(console.info).mock.calls
    .map(([value]) => JSON.parse(String(value)))
    .filter((event) => event.event === "farm_job_completed");
}

function expectActivitySummary(database: ReturnType<typeof createDb>, otherChanges: number, errorCodes: string | null = null) {
  expect(completionEvents()).toEqual([expect.objectContaining({ sent: 0, failed: 0, blocked: 0, otherChanges, errorCodes })]);
  expect(database.summaryWrites()).toHaveLength(1);
  const summary = database.summaryWrites()[0];
  expect(summary.sql).toContain("ON CONFLICT(id) DO UPDATE");
  expect(summary.values.slice(6, 9)).toEqual([0, 0, 0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(mocks.env, {
    LINE_MESSAGING_ACCESS_TOKEN: "test-line-token",
    MADOU_GROUP_ID: "test-group",
    SALES_SYNC_API_URL: "https://sales.invalid/sync",
    SALES_SYNC_API_KEY: "test-sync-key",
  });
  vi.stubEnv("JOB_SECRET", "test-job-secret");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T07:10:00.000Z"));
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network access is forbidden in route tests"); }));
  mocks.claimRow.mockResolvedValue(true);
  mocks.sendLinePushMessage.mockResolvedValue({ ok: true });
  mocks.sendSalesSync.mockResolvedValue({ ok: true });
  mocks.queueDailyDigestIfDue.mockResolvedValue(false);
  mocks.reconcileMissingWorkCards.mockResolvedValue({ scanned: 0, recovered: 0 });
  mocks.processMadouPostbackAction.mockResolvedValue({ replyText: "Test retry result" });
  mocks.buildQueueMadouWebhookResultStatement.mockImplementation((db: D1Database, eventId: string, text: string) =>
    db.prepare("INSERT INTO farm_notification_outbox (id, content_snapshot_json) VALUES (?, ?)").bind(`result:${eventId}`, text),
  );
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe.each(routes)("$name hourly job integration", ({ name, post, row, table, send }) => {
  it("uses fresh invocation lease owners even when both runs share one hourly summary", async () => {
    const database = createDb({ outboxRows: [row] });
    const first = await (await post(request())).json() as JobResponse;
    const second = await (await post(request())).json() as JobResponse;

    expect(first.runId).toEqual(expect.any(String));
    expect(first.runId).not.toBe(second.runId);
    expect(first.runId).not.toMatch(/^hourly:/);
    expect(mocks.claimRow.mock.calls).toEqual([
      [database.db, table, row.id, first.runId],
      [database.db, table, row.id, second.runId],
    ]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(database.summaryWrites().map((statement) => statement.values[0])).toEqual([
      `${HOURLY_JOB_RUN_PREFIX}${name}:cron:2026-10-17T07:00:00.000Z`,
      `${HOURLY_JOB_RUN_PREFIX}${name}:cron:2026-10-17T07:00:00.000Z`,
    ]);
  });

  it("returns 200 after a completed send even if hourly summary persistence fails", async () => {
    const database = createDb({ outboxRows: [row], summaryWriteFails: true });
    const response = await post(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 1, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    const writes = database.writes();
    expect(writes).toHaveLength(2);
    expect(writes[0].sql).toContain(`UPDATE ${table} SET status = 'sent'`);
    expect(writes[0].values.at(-1)).toBe(row.id);
    expect(writes[1].sql).toContain("INSERT INTO farm_job_runs");
    expect(vi.mocked(console.error).mock.calls.map(([value]) => JSON.parse(String(value)))).toEqual([
      expect.objectContaining({ event: "farm_job_summary_write_failed", job: name, code: "summary_persistence_failed" }),
    ]);
  });

  it("does not send, mutate business rows, or count activity when the lease claim loses", async () => {
    const database = createDb({ outboxRows: [row] });
    mocks.claimRow.mockResolvedValue(false);
    const response = await post(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueCount: 1, sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(database.writes()).toEqual([]);
    expect(completionEvents()).toEqual([expect.objectContaining({ dueCount: 1, sent: 0, failed: 0, blocked: 0 })]);
    expect(completionEvents()[0].otherChanges ?? 0).toBe(0);
  });

  it("keeps idle polling successful when the existing hourly summary cannot be read", async () => {
    const database = createDb({ summaryReadFails: true });
    const response = await post(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueCount: 0, sent: 0 });
    expect(database.writes()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(completionEvents()).toEqual([
      expect.objectContaining({ dueCount: 0, sent: 0, configReady: true }),
    ]);
  });

  it("does not hide a business claim failure even when the failure summary also cannot be read", async () => {
    createDb({ outboxRows: [row], summaryReadFails: true });
    const businessError = new Error("test business claim failure");
    mocks.claimRow.mockRejectedValue(businessError);

    await expect(post(request())).rejects.toBe(businessError);
    expect(send).not.toHaveBeenCalled();
    expect(completionEvents()).toEqual([expect.objectContaining({ errorCodes: "job_execution_failed" })]);
  });

  it("preserves a completed send in the failure summary when a later row fails", async () => {
    const database = createDb({ outboxRows: [row, { ...row, id: `${row.id}-later` }] });
    const businessError = new Error("test later claim failure");
    mocks.claimRow.mockResolvedValueOnce(true).mockRejectedValueOnce(businessError);

    await expect(post(request())).rejects.toBe(businessError);

    expect(send).toHaveBeenCalledTimes(1);
    expect(database.writes()[0].sql).toContain(`UPDATE ${table} SET status = 'sent'`);
    expect(database.writes()[0].values.at(-1)).toBe(row.id);
    expect(database.summaryWrites()).toHaveLength(1);
    expect(database.summaryWrites()[0].values.slice(5, 9)).toEqual([2, 1, 0, 0]);
    expect(completionEvents()).toEqual([
      expect.objectContaining({ dueCount: 2, sent: 1, failed: 0, blocked: 0, errorCodes: "job_execution_failed" }),
    ]);
  });

  it("rejects unauthorized calls before touching D1 or creating a run", async () => {
    createDb();
    const response = await post(new Request("https://jobs.invalid/local-test", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.claimRow).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(completionEvents()).toEqual([]);
  });
});

describe("missing configuration guards", () => {
  it("skips reminder selection, claims, and outbox changes when the LINE token is missing", async () => {
    const database = createDb({ outboxRows: [reminderRow] });
    mocks.env.LINE_MESSAGING_ACCESS_TOKEN = "";
    const response = await reminders(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "credentials_not_configured", dueCount: 0, sent: 0, failed: 0 });
    expect(mocks.claimRow).not.toHaveBeenCalled();
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(database.executed.every((statement) => statement.sql.includes("farm_job_runs"))).toBe(true);
    expect(database.batches).toEqual([]);
    expect(completionEvents()).toEqual([
      expect.objectContaining({ dueCount: 0, sent: 0, failed: 0, blocked: 0, errorCodes: "no_credentials" }),
    ]);
    expect(completionEvents()[0].otherChanges ?? 0).toBe(0);
    expect(completionEvents()[0].configReady ?? false).toBe(false);
  });

  it.each([
    { label: "URL", apiUrl: "", apiKey: "test-sync-key" },
    { label: "key", apiUrl: "https://sales.invalid/sync", apiKey: "" },
    { label: "URL and key", apiUrl: "", apiKey: "" },
  ])("skips sales selection, claims, and outbox changes when the $label is missing", async ({ apiUrl, apiKey }) => {
    const database = createDb({ outboxRows: [salesRow] });
    mocks.env.SALES_SYNC_API_URL = apiUrl;
    mocks.env.SALES_SYNC_API_KEY = apiKey;
    const response = await salesSync(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "not_configured", dueCount: 0, sent: 0, failed: 0 });
    expect(mocks.claimRow).not.toHaveBeenCalled();
    expect(mocks.sendSalesSync).not.toHaveBeenCalled();
    expect(database.executed.every((statement) => statement.sql.includes("farm_job_runs"))).toBe(true);
    expect(database.batches).toEqual([]);
    expect(completionEvents()).toEqual([
      expect.objectContaining({ dueCount: 0, sent: 0, failed: 0, blocked: 0, errorCodes: "not_configured" }),
    ]);
    expect(completionEvents()[0].otherChanges ?? 0).toBe(0);
    expect(completionEvents()[0].configReady ?? false).toBe(false);
  });

  describe.each([
    { label: "group", groupId: "", token: "test-line-token", errorCode: "no_group_id" },
    { label: "token", groupId: "test-group", token: "", errorCode: "no_credentials" },
    { label: "group and token", groupId: "", token: "", errorCode: "no_group_id" },
  ])("Madou missing $label", ({ groupId, token, errorCode }) => {
    beforeEach(() => {
      mocks.env.MADOU_GROUP_ID = groupId;
      mocks.env.LINE_MESSAGING_ACCESS_TOKEN = token;
    });

    it("still checks webhook retries and the digest, but never selects or claims notification rows", async () => {
      const database = createDb({ outboxRows: [groupRow] });
      const response = await madouGroup(request());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ mode: "credentials_not_configured", digestQueued: false, dueCount: 0, sent: 0 });
      expect(database.executed.filter((statement) => statement.method === "all")).toEqual([
        expect.objectContaining({ sql: expect.stringContaining("FROM farm_line_webhook_events") }),
      ]);
      expect(database.executed.some((statement) => statement.sql.includes("farm_notification_outbox"))).toBe(false);
      expect(mocks.queueDailyDigestIfDue).toHaveBeenCalledWith(database.db, new Date("2026-10-17T07:10:00.000Z"));
      expect(mocks.reconcileMissingWorkCards).toHaveBeenCalledWith(database.db);
      expect(mocks.queueDailyDigestIfDue.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcileMissingWorkCards.mock.invocationCallOrder[0]);
      expect(mocks.claimRow).not.toHaveBeenCalled();
      expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
      expect(database.writes().every((statement) => statement.sql.includes("farm_job_runs"))).toBe(true);
      expect(completionEvents()).toEqual([
        expect.objectContaining({ dueCount: 0, sent: 0, failed: 0, blocked: 0, otherChanges: 0, errorCodes: errorCode }),
      ]);
      expect(completionEvents()[0].configReady ?? false).toBe(false);
    });

    it.each([
      { outcome: "success", retryError: null, retried: 1, deadLettered: 0, retryFailed: 0 },
      { outcome: "nonterminal failure", retryError: "webhook_retry_failed", retried: 0, deadLettered: 0, retryFailed: 1 },
      { outcome: "missing actor", retryError: "webhook_actor_missing", retried: 0, deadLettered: 1, retryFailed: 0 },
    ])("preserves retry $outcome and queued-digest activity before skipping notification sends", async ({ outcome, retryError, retried, deadLettered, retryFailed }) => {
      const database = createDb({
        outboxRows: [groupRow], retryRows: [retryRow],
        ...(outcome === "missing actor" ? { member: null } : {}),
      });
      mocks.queueDailyDigestIfDue.mockResolvedValue(true);
      if (outcome === "nonterminal failure") mocks.processMadouPostbackAction.mockRejectedValue(new Error("test retry detail"));
      const response = await madouGroup(request());
      const body = await response.json() as JobResponse;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        mode: "credentials_not_configured", digestQueued: true, dueCount: 0, sent: 0,
        webhookRetryDueCount: 1, webhookRetried: retried, webhookDeadLettered: deadLettered, webhookRetryFailed: retryFailed,
      });
      expect(mocks.claimRow.mock.calls).toEqual([[database.db, "farm_line_webhook_events", retryRow.id, body.runId]]);
      expect(mocks.claimRow.mock.invocationCallOrder[0]).toBeLessThan(mocks.queueDailyDigestIfDue.mock.invocationCallOrder[0]);
      expect(database.executed.some((statement) => statement.sql.includes("FROM farm_notification_outbox"))).toBe(false);
      expect(database.writes().some((statement) => statement.sql.includes("farm_notification_outbox"))).toBe(false);
      expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
      const expectedErrors = [errorCode, ...(retryError ? [retryError] : [])].sort().join(",");
      expectActivitySummary(database, 2, expectedErrors);
      expect(completionEvents()[0].dueCount).toBe(1);
      expect(completionEvents()[0].configReady ?? false).toBe(false);
      if (outcome === "success") {
        expect(database.batches).toHaveLength(1);
        expect(database.batches[0]).toHaveLength(2);
        expect(database.batches[0][0].sql).toContain("status = 'processed'");
        expect(database.batches[0][1].sql).toContain("INSERT INTO farm_notification_outbox");
      } else {
        expect(database.batches).toEqual([]);
        expect(database.writes()[0].sql).toContain("UPDATE farm_line_webhook_events");
      }
    });
  });
});

describe("activity without an external send", () => {
  it.each([
    "2026-10-17T07:09:59.000Z",
    "2026-10-17T07:10:00.000Z",
  ])("cancels a reminder whose visit has already started at %s without sending", async (startsAt) => {
    const database = createDb({ outboxRows: [{ ...reminderRow, starts_at: startsAt }] });
    const response = await reminders(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueCount: 1, cancelledStale: 1, sent: 0, failed: 0 });
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(database.writes()[0]).toMatchObject({ values: [reminderRow.id] });
    expect(database.writes()[0].sql).toContain("status = 'cancelled'");
    expect(database.writes()[0].sql).toContain("last_error = 'visit_already_passed'");
    expectActivitySummary(database, 1);
  });

  it("records cancelled stale reminders as activity and retains their cancellation", async () => {
    const database = createDb({ outboxRows: [{ ...reminderRow, cancelled_at: "2026-10-17T06:00:00.000Z" }] });
    const response = await reminders(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueCount: 1, cancelledStale: 1, sent: 0 });
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(database.writes()[0]).toMatchObject({
      sql: "UPDATE farm_notification_outbox SET status = 'cancelled', leased_until = NULL WHERE id = ?", values: [reminderRow.id],
    });
    expectActivitySummary(database, 1);
  });

  it("records a newly queued Madou digest even when no notification is due", async () => {
    const database = createDb();
    mocks.queueDailyDigestIfDue.mockResolvedValue(true);
    const response = await madouGroup(request());

    expect(await response.json()).toMatchObject({ digestQueued: true, dueCount: 0, sent: 0 });
    expect(mocks.queueDailyDigestIfDue).toHaveBeenCalledWith(database.db, new Date("2026-10-17T07:10:00.000Z"));
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expectActivitySummary(database, 1);
  });

  it("records superseded Madou work cards and cancels them instead of sending stale content", async () => {
    const database = createDb({ outboxRows: [supersededRow], bookingState: { cancelled_at: null, visit_version: 2 } });
    const response = await madouGroup(request());

    expect(await response.json()).toMatchObject({ dueCount: 1, superseded: 1, sent: 0 });
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(database.writes()[0]).toMatchObject({ values: ["superseded_by_newer_booking_state", supersededRow.id] });
    expect(database.writes()[0].sql).toContain("status = 'cancelled'");
    expectActivitySummary(database, 1);
  });
});

describe("Madou pending work cards", () => {
  it("sends a pending card for a still-requested booking using the upstream pending-card message", async () => {
    const database = createDb({
      outboxRows: [pendingRow], bookingState: { cancelled_at: null, visit_version: 1, booking_status: "requested" },
    });
    const response = await madouGroup(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueCount: 1, sent: 1, superseded: 0, failed: 0 });
    expect(database.executed.find((statement) => statement.sql.includes("FROM farm_bookings"))?.sql)
      .toMatch(/^SELECT .*\bbooking_status\b.* FROM farm_bookings/);
    expect(mocks.sendLinePushMessage).toHaveBeenCalledWith("test-line-token", "test-group", [
      expect.objectContaining({
        type: "template", altText: "待接待預約 TEST-1",
        template: expect.objectContaining({ type: "buttons", text: expect.stringContaining("尚未有人接待") }),
      }),
    ], pendingRow.id);
    expect(database.writes()[0].sql).toContain("status = 'sent'");
    expect(completionEvents()).toEqual([expect.objectContaining({ sent: 1, failed: 0, otherChanges: 0 })]);
  });

  it.each(["confirmed", "cancelled"])("cancels pending cards when booking_status has moved to %s at the same visit version", async (bookingStatus) => {
    const database = createDb({
      outboxRows: [pendingRow], bookingState: { cancelled_at: null, visit_version: 1, booking_status: bookingStatus },
    });
    const response = await madouGroup(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ dueCount: 1, sent: 0, superseded: 1, failed: 0 });
    expect(database.executed.find((statement) => statement.sql.includes("FROM farm_bookings"))?.sql)
      .toMatch(/^SELECT .*\bbooking_status\b.* FROM farm_bookings/);
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(database.writes()[0].sql).toContain("status = 'cancelled'");
    expect(database.writes()[0].values).toEqual(["superseded_by_newer_booking_state", pendingRow.id]);
    expectActivitySummary(database, 1);
  });
});

describe("Madou phase 0 webhook retry activity", () => {
  it("keeps successful retry processing and delayed-result enqueue in the same batch", async () => {
    const database = createDb({ retryRows: [retryRow] });
    const response = await madouGroup(request());
    const body = await response.json() as JobResponse;

    expect(body).toMatchObject({ dueCount: 0, webhookRetryDueCount: 1, webhookRetried: 1, webhookDeadLettered: 0, webhookRetryFailed: 0 });
    expect(mocks.claimRow).toHaveBeenCalledWith(database.db, "farm_line_webhook_events", retryRow.id, body.runId);
    expect(mocks.processMadouPostbackAction).toHaveBeenCalledWith(database.db, "claim", "booking-1", 1,
      { id: "staff-1", display_name: "Test staff", role: "admin" }, retryRow.id);
    expect(mocks.buildQueueMadouWebhookResultStatement).toHaveBeenCalledWith(database.db, retryRow.id, "[延遲處理] Test retry result");
    expect(database.batches).toHaveLength(1);
    expect(database.batches[0]).toHaveLength(2);
    expect(database.batches[0][0].sql).toContain("SET status = 'processed'");
    expect(database.batches[0][0].values.at(-1)).toBe(retryRow.id);
    expect(database.batches[0][1].sql).toContain("INSERT INTO farm_notification_outbox");
    expect(completionEvents()[0].dueCount).toBe(1);
    expectActivitySummary(database, 1);
  });

  it.each([
    { label: "nonterminal", attempts: 0, status: "queued", deadLettered: 0 },
    { label: "terminal", attempts: MAX_SEND_ATTEMPTS - 1, status: "dead_letter", deadLettered: 1 },
  ])("preserves $label failed retries as activity and records a safe error code", async ({ attempts, status, deadLettered }) => {
    const database = createDb({ retryRows: [{ ...retryRow, attempt_count: attempts }] });
    mocks.processMadouPostbackAction.mockRejectedValue(new Error("test retry error detail"));
    const response = await madouGroup(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ webhookRetried: 0, webhookRetryFailed: 1, webhookDeadLettered: deadLettered });
    expect(database.writes()[0].sql).toContain("UPDATE farm_line_webhook_events SET status = ?");
    expect(database.writes()[0].values.slice(0, 3)).toEqual([status, attempts + 1, "test retry error detail"]);
    expect(database.writes()[0].values.at(-1)).toBe(retryRow.id);
    expect(database.batches).toEqual([]);
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expectActivitySummary(database, 1, "webhook_retry_failed");
  });

  it("records actor-missing dead letters without executing or reattributing the action", async () => {
    const database = createDb({ retryRows: [retryRow], member: null });
    const response = await madouGroup(request());

    expect(await response.json()).toMatchObject({ webhookRetried: 0, webhookRetryFailed: 0, webhookDeadLettered: 1 });
    expect(mocks.processMadouPostbackAction).not.toHaveBeenCalled();
    expect(mocks.buildQueueMadouWebhookResultStatement).not.toHaveBeenCalled();
    expect(database.writes()[0].sql).toContain("status = 'dead_letter'");
    expect(database.writes()[0].sql).toContain("error = 'actor_member_missing'");
    expect(database.writes()[0].values.at(-1)).toBe(retryRow.id);
    expectActivitySummary(database, 1, "webhook_actor_missing");
  });

  it("does not count selected webhook rows as activity when their claims lose", async () => {
    const database = createDb({ retryRows: [retryRow] });
    mocks.claimRow.mockResolvedValue(false);
    const response = await madouGroup(request());

    expect(await response.json()).toMatchObject({ webhookRetryDueCount: 1, webhookRetried: 0, webhookDeadLettered: 0, webhookRetryFailed: 0 });
    expect(mocks.processMadouPostbackAction).not.toHaveBeenCalled();
    expect(mocks.buildQueueMadouWebhookResultStatement).not.toHaveBeenCalled();
    expect(database.executed.some((statement) => statement.sql.includes("FROM members"))).toBe(false);
    expect(database.writes()).toEqual([]);
    expect(database.batches).toEqual([]);
    expect(completionEvents()).toEqual([expect.objectContaining({ dueCount: 1, sent: 0, failed: 0, blocked: 0, otherChanges: 0 })]);
  });

  it("preserves completed webhook retry activity if a later digest query throws", async () => {
    const database = createDb({ retryRows: [retryRow] });
    const businessError = new Error("test later digest query failure");
    mocks.queueDailyDigestIfDue.mockRejectedValue(businessError);

    await expect(madouGroup(request())).rejects.toBe(businessError);

    expect(database.batches).toHaveLength(1);
    expect(database.batches[0][0].sql).toContain("SET status = 'processed'");
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expectActivitySummary(database, 1, "job_execution_failed");
    expect(completionEvents()[0].dueCount).toBe(1);
  });

  it("adds retry, digest, and superseded-card activity without losing any category", async () => {
    const database = createDb({ retryRows: [retryRow], outboxRows: [supersededRow], bookingState: { cancelled_at: null, visit_version: 2 } });
    mocks.queueDailyDigestIfDue.mockResolvedValue(true);
    const response = await madouGroup(request("manual"));
    const body = await response.json() as JobResponse;

    expect(body).toMatchObject({ digestQueued: true, superseded: 1, webhookRetried: 1, sent: 0 });
    expect(mocks.claimRow.mock.calls.map((call) => call[3])).toEqual([body.runId, body.runId]);
    expectActivitySummary(database, 3);
    expect(completionEvents()[0]).toMatchObject({ dueCount: 2, source: "manual" });
    expect(database.summaryWrites()[0].values[0]).toBe(`${HOURLY_JOB_RUN_PREFIX}madou-group:manual:2026-10-17T07:00:00.000Z`);
  });
});

describe("upstream Madou reconciliation integration", () => {
  it.each([true, false])("preserves repair before the delivery guard when configured=%s", async (configured) => {
    const database = createDb();
    if (!configured) mocks.env.LINE_MESSAGING_ACCESS_TOKEN = "";
    mocks.reconcileMissingWorkCards.mockResolvedValue({ scanned: 20, recovered: 20 });

    const response = await madouGroup(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: configured ? "processing" : "credentials_not_configured",
      reconciled: { scanned: 20, recovered: 20 }, dueCount: 0, sent: 0,
    });
    expect(mocks.reconcileMissingWorkCards).toHaveBeenCalledWith(database.db);
    expect(mocks.queueDailyDigestIfDue.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcileMissingWorkCards.mock.invocationCallOrder[0]);
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expect(completionEvents()[0].otherChanges).toBe(0);
    expect(completionEvents()[0].configReady ?? false).toBe(configured);
    const diagnostic = vi.mocked(console.info).mock.calls.map(([value]) => JSON.parse(String(value)))
      .find((event) => event.event === "farm_job_reconciliation_checked");
    expect(diagnostic).toEqual({
      event: "farm_job_reconciliation_checked", job: "madou-group", runId: expect.any(String),
      source: "cron", candidateCount: 20, reportedRecoveryAttempts: 20,
    });
    // Missing-config error persistence is separately guarded; candidate counts
    // never become a success counter or actual D1 mutation estimate.
    if (configured) expect(database.writes()).toEqual([]);
  });

  it("does not write another summary for repeatedly scanned reconciliation candidates", async () => {
    const database = createDb();
    mocks.reconcileMissingWorkCards.mockResolvedValue({ scanned: 20, recovered: 20 });

    await madouGroup(request());
    await madouGroup(request());

    expect(mocks.reconcileMissingWorkCards).toHaveBeenCalledTimes(2);
    expect(database.writes()).toEqual([]);
    expect(completionEvents()).toHaveLength(2);
    expect(completionEvents().every((event) => event.otherChanges === 0 && event.sent === 0)).toBe(true);
  });

  it("adds no reconciliation diagnostic for a fully empty check", async () => {
    const database = createDb();
    const response = await madouGroup(request());

    expect(await response.json()).toMatchObject({ reconciled: { scanned: 0, recovered: 0 } });
    expect(database.writes()).toEqual([]);
    expect(vi.mocked(console.info).mock.calls.map(([value]) => JSON.parse(String(value)).event))
      .toEqual(["farm_job_completed"]);
  });

  it("keeps actual send counts independent from reported reconciliation recovery", async () => {
    const database = createDb({ outboxRows: [groupRow] });
    mocks.reconcileMissingWorkCards.mockResolvedValue({ scanned: 20, recovered: 20 });

    const response = await madouGroup(request());
    expect(await response.json()).toMatchObject({ sent: 1, reconciled: { scanned: 20, recovered: 20 } });
    expect(database.summaryWrites()).toHaveLength(1);
    expect(completionEvents()).toEqual([expect.objectContaining({ sent: 1, failed: 0, otherChanges: 0 })]);
  });

  it("preserves webhook and digest progress when reconciliation throws", async () => {
    const database = createDb({ retryRows: [retryRow] });
    mocks.queueDailyDigestIfDue.mockResolvedValue(true);
    const businessError = new Error("test reconciliation detail must not enter summary");
    mocks.reconcileMissingWorkCards.mockRejectedValue(businessError);

    await expect(madouGroup(request())).rejects.toBe(businessError);

    expect(database.batches).toHaveLength(1);
    expect(mocks.sendLinePushMessage).not.toHaveBeenCalled();
    expectActivitySummary(database, 2, "job_execution_failed");
    expect(completionEvents()[0].dueCount).toBe(1);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(businessError.message);
  });
});
