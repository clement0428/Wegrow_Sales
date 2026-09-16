export const DEFAULT_CAPACITY_POLICY = {
  maxGroups: 3,
  totalLimitByGroupCount: { 1: 50, 2: 30, 3: 15 },
} as const;

export type CapacityPolicy = {
  maxGroups: number;
  totalLimitByGroupCount: Record<number, number>;
};

export type CapacityResult = {
  accepted: boolean;
  groupCount: number;
  totalPeople: number;
  limit: number;
  reason: "available" | "invalid_group" | "max_groups" | "over_total_limit" | "missing_rule";
};

export function evaluateCapacity(
  groupSizes: number[],
  policy: CapacityPolicy = DEFAULT_CAPACITY_POLICY,
): CapacityResult {
  if (groupSizes.some((size) => !Number.isInteger(size) || size < 1)) {
    return { accepted: false, groupCount: groupSizes.length, totalPeople: 0, limit: 0, reason: "invalid_group" };
  }

  const groupCount = groupSizes.length;
  const totalPeople = groupSizes.reduce((sum, size) => sum + size, 0);
  if (groupCount === 0) {
    return { accepted: true, groupCount, totalPeople, limit: 0, reason: "available" };
  }
  if (groupCount > policy.maxGroups) {
    return { accepted: false, groupCount, totalPeople, limit: 0, reason: "max_groups" };
  }

  const limit = policy.totalLimitByGroupCount[groupCount];
  if (!Number.isInteger(limit) || limit < 1) {
    return { accepted: false, groupCount, totalPeople, limit: 0, reason: "missing_rule" };
  }
  return {
    accepted: totalPeople <= limit,
    groupCount,
    totalPeople,
    limit,
    reason: totalPeople <= limit ? "available" : "over_total_limit",
  };
}

export function maxNewGroupSize(
  existingGroupSizes: number[],
  policy: CapacityPolicy = DEFAULT_CAPACITY_POLICY,
): number {
  const nextCount = existingGroupSizes.length + 1;
  if (nextCount > policy.maxGroups) return 0;
  const limit = policy.totalLimitByGroupCount[nextCount];
  if (!limit) return 0;
  return Math.max(0, limit - existingGroupSizes.reduce((sum, size) => sum + size, 0));
}

export function canFit(
  existingGroupSizes: number[],
  newGroupSize: number,
  policy: CapacityPolicy = DEFAULT_CAPACITY_POLICY,
): boolean {
  return evaluateCapacity([...existingGroupSizes, newGroupSize], policy).accepted;
}
