import { describe, expect, it } from "bun:test";
import { DEFAULT_POLICY, msToSeconds, policyFromEnv } from "../extensions/bash-timeout/core.ts";

describe("msToSeconds", () => {
  it("converts milliseconds to seconds exactly", () => {
    expect(msToSeconds(1_000)).toBe(1);
    expect(msToSeconds(30_000)).toBe(30);
    expect(msToSeconds(45_000)).toBe(45); // the value pi used to read as 12.5 hours
    expect(msToSeconds(120_000)).toBe(120);
    expect(msToSeconds(600_000)).toBe(600);
  });

  it("keeps fractional seconds instead of rounding (#1)", () => {
    expect(msToSeconds(1_200)).toBe(1.2); // used to round down to 1s and kill commands early
    expect(msToSeconds(90_500)).toBe(90.5);
  });

  it("preserves sub-second deadlines instead of clamping to 1s", () => {
    expect(msToSeconds(1)).toBe(0.001);
    expect(msToSeconds(500)).toBe(0.5);
  });
});

describe("policyFromEnv", () => {
  it("defaults to Claude Code's Bash semantics", () => {
    expect(DEFAULT_POLICY).toEqual({ defaultMs: 120_000, maxMs: 600_000 });
    expect(policyFromEnv({})).toEqual(DEFAULT_POLICY);
  });

  it("reads overrides and ignores junk", () => {
    expect(policyFromEnv({ PI_BASH_TIMEOUT_DEFAULT_MS: "30000", PI_BASH_TIMEOUT_MAX_MS: "abc" }))
      .toEqual({ defaultMs: 30_000, maxMs: 600_000 });
  });

  it("clamps the default to the maximum", () => {
    expect(policyFromEnv({ PI_BASH_TIMEOUT_DEFAULT_MS: "9000000" }))
      .toEqual({ defaultMs: 600_000, maxMs: 600_000 });
  });
});
