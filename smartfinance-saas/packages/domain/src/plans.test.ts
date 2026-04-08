import { describe, expect, it } from "vitest";
import { getDefaultPlanCode, getPlanDefinition } from "./plans";

describe("plan definitions", () => {
  it("falls back to the free plan", () => {
    expect(getDefaultPlanCode()).toBe("free");
    expect(getPlanDefinition("unknown").code).toBe("free");
  });

  it("gives paid plans broader limits", () => {
    const freePlan = getPlanDefinition("free");
    const proPlan = getPlanDefinition("pro_monthly");

    expect(proPlan.limits.uploadsPerMonth).toBeGreaterThan(freePlan.limits.uploadsPerMonth);
    expect(proPlan.capabilities.exportsEnabled).toBe(true);
  });
});
