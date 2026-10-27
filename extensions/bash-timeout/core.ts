/**
 * Pure timeout policy for pi's bash tool. No pi imports, so it is unit-testable.
 *
 * pi's bash `timeout` is in SECONDS with no default and a ~24.8 day ceiling.
 * Models trained on millisecond APIs (Claude Code, Playwright, ...) routinely
 * pass 60000 meaning one minute, which pi runs as 16.7 hours.
 */

export interface TimeoutPolicy {
  /** Applied when the model omits `timeout`. */
  defaultSeconds: number;
  /** Values at or above this are treated as milliseconds. */
  msThreshold: number;
  /** Hard ceiling after conversion. */
  maxSeconds: number;
}

export const DEFAULT_POLICY: TimeoutPolicy = {
  defaultSeconds: 120,
  msThreshold: 10_000,
  maxSeconds: 1_800,
};

export interface TimeoutDecision {
  original: unknown;
  timeout: number | undefined;
  changed: boolean;
  defaulted: boolean;
  fromMilliseconds: boolean;
  capped: boolean;
}

export function normalizeTimeout(raw: unknown, policy: TimeoutPolicy = DEFAULT_POLICY): TimeoutDecision {
  const base = { original: raw, defaulted: false, fromMilliseconds: false, capped: false };

  if (raw === undefined || raw === null) {
    return { ...base, timeout: policy.defaultSeconds, changed: true, defaulted: true };
  }
  // Leave invalid values to pi's own validation error.
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return { ...base, timeout: raw as number | undefined, changed: false };
  }

  let seconds = raw;
  let fromMilliseconds = false;
  if (seconds >= policy.msThreshold) {
    seconds = seconds / 1000;
    fromMilliseconds = true;
  }
  let capped = false;
  if (seconds > policy.maxSeconds) {
    seconds = policy.maxSeconds;
    capped = true;
  }
  return { ...base, timeout: seconds, changed: fromMilliseconds || capped, fromMilliseconds, capped };
}

/** Model-facing note appended to the tool result, or undefined when nothing is worth saying. */
export function noteFor(d: TimeoutDecision, policy: TimeoutPolicy, timedOut: boolean): string | undefined {
  const tag = "[pi-bash-timeout]";
  if (d.defaulted) {
    if (!timedOut) return undefined;
    return `${tag} No timeout was given, so the default ${policy.defaultSeconds}s applied. ` +
      `If the command legitimately needs longer, pass timeout in SECONDS (max ${policy.maxSeconds}), ` +
      `or run it in the background and poll.`;
  }
  const parts: string[] = [];
  if (d.fromMilliseconds) {
    parts.push(`timeout=${d.original} looked like milliseconds; bash timeout is in SECONDS, so it was read as ${Number(d.original) / 1000}s.`);
  }
  if (d.capped) {
    parts.push(`Capped at the ${policy.maxSeconds}s maximum. Run long-lived processes (dev servers, watchers) in the background (nohup/tmux) and poll instead of blocking.`);
  }
  if (parts.length === 0) return undefined;
  return `${tag} ${parts.join(" ")} Effective timeout: ${d.timeout}s.`;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

export function policyFromEnv(env: Record<string, string | undefined>): TimeoutPolicy {
  return {
    defaultSeconds: positive(env.PI_BASH_TIMEOUT_DEFAULT, DEFAULT_POLICY.defaultSeconds),
    msThreshold: positive(env.PI_BASH_TIMEOUT_MS_THRESHOLD, DEFAULT_POLICY.msThreshold),
    maxSeconds: positive(env.PI_BASH_TIMEOUT_MAX, DEFAULT_POLICY.maxSeconds),
  };
}
