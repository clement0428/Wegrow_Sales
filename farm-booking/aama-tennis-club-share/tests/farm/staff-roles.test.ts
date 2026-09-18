import { describe, expect, it } from "vitest";
import {
  isStaff, canManageSchedule, canHandlePayment, canCheckIn, canViewFullOrders, canViewSettings,
} from "@/lib/auth/roles";
import type { Member } from "@/lib/db/types";

function member(role: Member["role"]): Member {
  return {
    id: "m1", line_user_id: "line-1", display_name: "Test", picture_url: null, role,
    created_at: "", last_login_at: "", theme_preference: "clay",
    bank_code: null, bank_name: null, bank_account: null, bank_holder: null,
  };
}

// 規格第4節：管理員可排場次與處理收款；接待員可讀所需資訊、報到與工作單；
// 餐飲／備料角色只看必要數量和飲食資料。These pure functions are the single
// source of truth every /api/farm/admin/* route calls — if these are wrong,
// every route built on top of them is wrong the same way.
describe("staff role capabilities", () => {
  it("only admin/reception/kitchen count as staff", () => {
    expect(isStaff(member("admin"))).toBe(true);
    expect(isStaff(member("reception"))).toBe(true);
    expect(isStaff(member("kitchen"))).toBe(true);
    expect(isStaff(member("member"))).toBe(false);
  });

  it("only admin can manage scheduling (改期／開放日期)", () => {
    expect(canManageSchedule(member("admin"))).toBe(true);
    expect(canManageSchedule(member("reception"))).toBe(false);
    expect(canManageSchedule(member("kitchen"))).toBe(false);
  });

  it("only admin can handle payment", () => {
    expect(canHandlePayment(member("admin"))).toBe(true);
    expect(canHandlePayment(member("reception"))).toBe(false);
    expect(canHandlePayment(member("kitchen"))).toBe(false);
  });

  it("admin and reception can check in visitors; kitchen cannot", () => {
    expect(canCheckIn(member("admin"))).toBe(true);
    expect(canCheckIn(member("reception"))).toBe(true);
    expect(canCheckIn(member("kitchen"))).toBe(false);
  });

  it("admin and reception see full orders (contact + amount); kitchen does not", () => {
    expect(canViewFullOrders(member("admin"))).toBe(true);
    expect(canViewFullOrders(member("reception"))).toBe(true);
    expect(canViewFullOrders(member("kitchen"))).toBe(false);
  });

  it("only admin sees operational settings", () => {
    expect(canViewSettings(member("admin"))).toBe(true);
    expect(canViewSettings(member("reception"))).toBe(false);
    expect(canViewSettings(member("kitchen"))).toBe(false);
  });
});
