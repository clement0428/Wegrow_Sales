import { describe, expect, it } from "vitest";
import { canFit, evaluateCapacity, maxNewGroupSize } from "@/lib/farm/capacity";

describe("farm dynamic capacity", () => {
  const cases: Array<[number[], number, boolean]> = [
    [[], 50, true], [[], 51, false], [[40], 1, false], [[30], 1, false],
    [[20], 10, true], [[20], 11, false], [[15], 15, true], [[25], 5, true],
    [[30], 30, false], [[10, 5], 1, false], [[5, 5], 5, true], [[10, 3], 2, true],
    [[5, 5], 6, false], [[15, 15], 15, false], [[3, 3, 3], 1, false],
  ];

  it.each(cases)("existing %j plus %i => %s", (existing, incoming, accepted) => {
    expect(canFit(existing, incoming)).toBe(accepted);
  });

  it("reports the actual limit for the resulting group count", () => {
    expect(evaluateCapacity([20, 10])).toMatchObject({ accepted: true, groupCount: 2, totalPeople: 30, limit: 30 });
  });

  it("rejects invalid sizes", () => {
    expect(evaluateCapacity([0]).reason).toBe("invalid_group");
    expect(evaluateCapacity([1.5]).reason).toBe("invalid_group");
  });

  it("computes the next group's maximum instead of subtracting from 50", () => {
    expect(maxNewGroupSize([20])).toBe(10);
    expect(maxNewGroupSize([5, 5])).toBe(5);
    expect(maxNewGroupSize([3, 3, 3])).toBe(0);
  });
});
