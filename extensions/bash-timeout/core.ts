/**
 * Timeout policy for the overridden shell tools, aligned with Claude Code's
 * Bash tool: `timeout` is in MILLISECONDS, default 120000 (2 min), hard max
 * 600000 (10 min). No pi imports, so it stays unit-testable.
 */

export interface TimeoutPolicy {
  /** Milliseconds applied when the model omits `timeout`. */
  defaultMs: number;
  /** Hard ceiling in milliseconds, enforced by the tool schema. */
  maxMs: number;
}

/** Claude Code's Bash tool semantics. */
export const DEFAULT_POLICY: TimeoutPolicy = {
  defaultMs: 120_000,
  maxMs: 600_000,
};

/**
 * pi's `timeout` is in seconds and accepts fractional values — its backend
 * just multiplies by 1000 and hands the result to setTimeout — so milliseconds
 * convert exactly. No rounding: it would shift the requested deadline in both
 * directions (1200 ms became 1 s, 150 ms became 1 s). See issue #1.
 */
export function msToSeconds(ms: number): number {
  return ms / 1000;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function policyFromEnv(env: Record<string, string | undefined>): TimeoutPolicy {
  const maxMs = positive(env.PI_BASH_TIMEOUT_MAX_MS, DEFAULT_POLICY.maxMs);
  const defaultMs = Math.min(positive(env.PI_BASH_TIMEOUT_DEFAULT_MS, DEFAULT_POLICY.defaultMs), maxMs);
  return { defaultMs, maxMs };
}
