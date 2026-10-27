# pi-bash-timeout

Default, sane-unit, capped `timeout` for pi's `bash` and `powershell` tools.

## Background

pi's `bash` tool exposes a `timeout` parameter, documented as **seconds**:

```ts
// @earendil-works/pi-coding-agent dist/core/tools/bash.js
const MAX_TIMEOUT_MS = 2_147_483_647;              // Node setTimeout's int32 limit
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;  // ≈ 24.8 days

function resolveTimeoutMs(timeout) {
  if (timeout === undefined) return undefined;       // no timer armed at all
  const timeoutMs = timeout * 1000;                   // input × 1000, as seconds
  if (timeoutMs > MAX_TIMEOUT_MS) throw new Error(...);
  return timeoutMs;
}
```

Three things fall out of this, and all three bit us in practice:

1. **No default.** If the model omits `timeout`, no timer is ever armed. A command that hangs — waiting on a prompt, a stuck daemon, a network call with no client-side timeout — blocks the session forever. One of us left an agent running overnight to build a product and came back to find it stuck on a single command from before midnight.

2. **The unit is seconds, but models write milliseconds.** Most of a model's training data on "how to call a shell tool with a timeout" comes from APIs that use milliseconds — Claude Code's `Bash` tool, Playwright, Node's own `setTimeout`. Habit carries over. We pulled real session logs and found the model routinely passing values like `10000`, `60000`, `90000`, `120000`, `600000` — all "round numbers in milliseconds," all silently accepted by pi as *seconds*:

   | Model wrote (thinking ms) | Intended | pi actually waits |
   |---|---|---|
   | `10000` | 10s | 2.8 hours |
   | `60000` | 1 min | 16.7 hours |
   | `90000` | 1.5 min | 25 hours |
   | `120000` | 2 min | 33.3 hours |
   | `600000` | 10 min | 7 days |

   In one session the same tool call mixed both conventions without the model noticing: a nested Playwright call correctly used `{ timeout: 45000 }` (milliseconds, 45s), while the enclosing pi `bash` call used `"timeout": 90000` meaning 90 seconds — and got ~25 hours instead.

3. **The accepted range is enormous and unchecked.** The only validation is against `MAX_TIMEOUT_MS` (int32 overflow), so nothing stops a value that is off by 1000x short of ~24.8 days. There's no "this is probably wrong" signal anywhere.

This isn't a crash or a visible error — the call just sits there looking busy, and depending on how you run pi, nothing ever surfaces the mismatch. The fix needs to happen before the command runs, since by the time it times out (if it ever does) the night is already gone.

### Why not fix pi itself?

This exact problem has been reported upstream multiple times — unit confusion, no default, no sane cap (see earendil-works/pi issues #9785, #9151, #1335, #9460, #8857, #5484, among others). The maintainer's position (on #1335) is explicit: *"The agent is supposed to set a timeout for long running tasks. We can not anticipate what a good default timeout is."* Consistent with pi's stated philosophy of a minimal core and pushing this kind of policy into extensions, those issues were closed without a core change. So: an extension.

## What it does

| Model passes | Extension sets | Note added to the result |
|---|---|---|
| nothing | `120` (seconds) | only if the command then timed out |
| `30` | `30` (unchanged) | — |
| `90000` (≥ 10000) | `90` — read as milliseconds | yes |
| `3600` | `1800` — capped | yes |
| `0`, `-1`, `"60"` | unchanged | — (left for pi's own validation to reject) |

Applies to both `bash` and `powershell` tool calls.

## How it works

It hooks the `tool_call` event and mutates `event.input.timeout` **in place**, before pi's bash implementation ever sees it — it does not re-register or wrap the `bash` tool. That keeps the built-in tool, its renderer, and any other extension that also touches bash (permission gates, loggers, etc.) working unmodified, and it also covers bash calls made indirectly from a codemode script, since those go through the same hook.

When it changed something worth telling the model about, a `tool_result` handler appends a short note (prefixed `[pi-bash-timeout]`) to the tool output, so the model can self-correct on the next call instead of silently having its intent overridden forever.

The core normalization (`normalizeTimeout`, `noteFor`) lives in `extensions/bash-timeout/core.ts` with no pi imports, so it's unit-testable on its own.

## Install

```bash
pi install /path/to/pi-bash-timeout
# or try it for one session without installing
pi -e /path/to/pi-bash-timeout
```

## Configure

No config file — three env vars, read once at session start:

| Env var | Default | Meaning |
|---|---|---|
| `PI_BASH_TIMEOUT_DEFAULT` | `120` | Seconds used when `timeout` is omitted |
| `PI_BASH_TIMEOUT_MS_THRESHOLD` | `10000` | Values ≥ this are treated as milliseconds |
| `PI_BASH_TIMEOUT_MAX` | `1800` | Hard ceiling in seconds, after unit correction |

## Limitations

- The millisecond heuristic is a threshold, not a proof: a command that legitimately needs a timeout between `PI_BASH_TIMEOUT_MS_THRESHOLD` and 24.8 days in *seconds* will be misread as milliseconds and shrunk. In practice, no interactive foreground command needs a multi-hour timeout — long-running processes (dev servers, watchers) belong in the background — so this trade-off favors not hanging the session over the rare legitimate long wait. Raise `PI_BASH_TIMEOUT_MS_THRESHOLD` if your workload actually needs values in that range.
- It only touches `bash` and `powershell`. Other tools or MCP servers with their own timeout semantics are unaffected.

## Test

```bash
bun test
```
