import { describe, expect, it } from "vitest";
import { classifyLineError } from "@/lib/line/error-classification";

describe("classifyLineError", () => {
  it("401 is a credential error — never retryable", () => {
    expect(classifyLineError(401)).toBe("credential");
  });
  it("400 is a permanent request error — never retryable", () => {
    expect(classifyLineError(400)).toBe("permanent");
  });
  it("429 and 5xx are transient — worth limited retry", () => {
    expect(classifyLineError(429)).toBe("transient");
    expect(classifyLineError(500)).toBe("transient");
    expect(classifyLineError(503)).toBe("transient");
  });
  it("unknown status codes default to transient, not permanent — never silently give up on an unrecognized code", () => {
    expect(classifyLineError(418)).toBe("transient");
  });
});
