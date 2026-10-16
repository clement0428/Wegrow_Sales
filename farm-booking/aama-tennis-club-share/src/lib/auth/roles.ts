import type { Member } from "@/lib/db/types";

// Pure role-capability checks — no "server-only" / next/headers dependency,
// so they're testable directly. current-member.ts re-exports these and adds
// the request-scoped requireStaff()/requireAdmin() wrappers around them.
//
// 三種角色（規格第4節）：管理員可排場次與處理收款；接待員可讀所需資訊、報到與
// 工作單；餐飲／備料角色只看必要數量和飲食資料，不看電話及收款。
// Every /api/farm/admin/* route calls these directly — "權限須在 API
// enforce，不能只藏按鈕".
export const STAFF_ROLES = ["admin", "reception", "kitchen"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const isAdmin = (m: Member) => m.role === "admin";
export const isStaff = (m: Member): m is Member & { role: StaffRole } => (STAFF_ROLES as readonly string[]).includes(m.role);
export const canManageSchedule = (m: Member) => m.role === "admin"; // 開放日期、改期
export const canHandlePayment = (m: Member) => m.role === "admin"; // 收款登記
export const canCheckIn = (m: Member) => m.role === "admin" || m.role === "reception"; // 報到
export const canClaimBooking = (m: Member) => m.role === "admin" || m.role === "reception"; // 麻豆現場群「我接單」
export const canViewFullOrders = (m: Member) => m.role === "admin" || m.role === "reception"; // 含聯絡方式／金額
export const canViewSettings = (m: Member) => m.role === "admin";
