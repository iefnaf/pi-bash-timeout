import { describe, expect, it } from "bun:test";
import { DEFAULT_POLICY, noteFor, normalizeTimeout, policyFromEnv } from "../extensions/bash-timeout/core.ts";

describe("normalizeTimeout", () => {
  it("applies the default when omitted", () => {
    const d = normalizeTimeout(undefined);
    expect(d).toMatchObject({ timeout: 120, changed: true, defaulted: true });
  });

  it("keeps reasonable second values", () => {
    for (const v of [1, 30, 120, 600, 1800]) {
      expect(normalizeTimeout(v)).toMatchObject({ timeout: v, changed: false });
    }
  });

  it("converts millisecond-looking values", () => {
    // values actually seen in session logs
    expect(normalizeTimeout(10_000).timeout).toBe(10);
    expect(normalizeTimeout(60_000).timeout).toBe(60);
    expect(normalizeTimeout(90_000).timeout).toBe(90);
    expect(normalizeTimeout(120_000).timeout).toBe(120);
    expect(normalizeTimeout(600_000).timeout).toBe(600);
    expect(normalizeTimeout(1_200_000)).toMatchObject({ timeout: 1200, fromMilliseconds: true, capped: false });
  });

  it("caps large values in either unit", () => {
    expect(normalizeTimeout(3600)).toMatchObject({ timeout: 1800, capped: true, fromMilliseconds: false });
    expect(normalizeTimeout(3_600_000)).toMatchObject({ timeout: 1800, capped: true, fromMilliseconds: true });
  });

  it("leaves invalid values for pi to reject", () => {
    for (const v of [0, -5, Number.NaN, "60"]) {
      expect(normalizeTimeout(v).changed).toBe(false);
    }
  });
});

describe("noteFor", () => {
  it("is silent for a default that did not time out", () => {
    expect(noteFor(normalizeTimeout(undefined), DEFAULT_POLICY, false)).toBeUndefined();
  });

  it("explains a default that timed out", () => {
    expect(noteFor(normalizeTimeout(undefined), DEFAULT_POLICY, true)).toContain("default 120s");
  });

  it("explains the unit conversion", () => {
    const note = noteFor(normalizeTimeout(90_000), DEFAULT_POLICY, false)!;
    expect(note).toContain("milliseconds");
    expect(note).toContain("Effective timeout: 90s");
  });

  it("explains the cap", () => {
    expect(noteFor(normalizeTimeout(7200), DEFAULT_POLICY, false)).toContain("1800s maximum");
  });
});

describe("policyFromEnv", () => {
  it("reads overrides and ignores junk", () => {
    expect(policyFromEnv({ PI_BASH_TIMEOUT_DEFAULT: "300", PI_BASH_TIMEOUT_MAX: "abc", PI_BASH_TIMEOUT_MS_THRESHOLD: "-1" }))
      .toEqual({ ...DEFAULT_POLICY, defaultSeconds: 300 });
  });
});
