# pi-bash-timeout

`timeout` in **milliseconds** for pi's `bash` and `powershell` tools — aligned with
Claude Code's Bash tool: **default 120000 ms (2 min), max 600000 ms (10 min)**.

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

3. **The accepted range is enormous and unchecked.** The only validation is against `MAX_TIMEOUT_MS` (int32 overflow), so nothing stops a value that is off by 1000x short of ~24.8 days. There's no "this is probably wrong" signal anywhere.

This isn't a crash or a visible error — the call just sits there looking busy. The fix needs to happen before the command runs.

### Why not fix pi itself?

This exact problem has been reported upstream multiple times — unit confusion, no default, no sane cap (see earendil-works/pi issues #9785, #9151, #1335, #9460, #8857, #5484, among others). The maintainer's position (on #1335) is explicit: *"The agent is supposed to set a timeout for long running tasks. We can not anticipate what a good default timeout is."* Consistent with pi's stated philosophy of a minimal core and pushing this kind of policy into extensions, those issues were closed without a core change. So: an extension.

## What it does

Earlier versions of this extension hooked `tool_call` and *guessed* the unit from
magnitude (`>= 10000` → milliseconds). That heuristic had an unfixable blind spot:
`5000` meaning 5 seconds was read as 5000 seconds, while `1200` meaning 20 minutes
was read as 1.2 seconds — a bare number carries no unit. **v0.2 removes the
guessing entirely** by re-declaring the tool:

| Model passes | What happens |
|---|---|
| nothing | default `120000` ms (120 s) applies |
| `30000` | 30 seconds — read as milliseconds, like Claude Code |
| `5000` | 5 seconds — no blind spot, small values are milliseconds too |
| `600001`+ | **rejected by schema validation** with a clear message; model retries |
| `0`, `-1`, `"60"` | rejected by schema validation |

The schema the model sees — and that arguments are validated against *before* the
tool runs — states the unit, the default, and the maximum. A wrong unit or an
over-max value becomes an explicit validation error instead of a silent misread.

## How it works

The extension registers tools named `bash` and `powershell`, which override the
built-ins by name (pi's documented tool-override mechanism). The registration
spreads pi's own tool definitions (`createBashToolDefinition` /
`createPowerShellToolDefinition`), so renderers, output schema, prompt snippets,
and constrained sampling stay identical; only the `timeout` parameter is
re-declared in milliseconds, and `execute` converts them to seconds exactly
(pi accepts fractional seconds — its backend multiplies by 1000 for setTimeout)
before delegating to pi's implementation.

Because it's the same tool name:

- other extensions' `tool_call` hooks (permission gates, loggers) still see `bash`
  calls and keep working;
- `codemode` scripts calling `tools.bash` get the same millisecond semantics;
- user shell settings (`shellPath`, `shellCommandPrefix`) are honored.

If no `timeout` is given, the default is applied before delegation — pi itself
would arm no timer at all.

`powershell` is registered with `defaultActive: false`: it stays out of the toolset
exactly as before unless you enabled it yourself (`--tools powershell` or the
`defaultTools` setting).

## Install

```bash
pi install /path/to/pi-bash-timeout
# or try it for one session without installing
pi -e /path/to/pi-bash-timeout
```

## Configure

No config file — two env vars, read once at session start:

| Env var | Default | Meaning |
|---|---|---|
| `PI_BASH_TIMEOUT_DEFAULT_MS` | `120000` | Milliseconds used when `timeout` is omitted |
| `PI_BASH_TIMEOUT_MAX_MS` | `600000` | Hard ceiling, enforced by the tool schema |

## Limitations

- Over-max values are *rejected*, not capped — the model gets a validation error
  and retries smaller. This matches Claude Code; long-lived processes (dev
  servers, watchers) belong in the background with polling, not in a 10-minute
  foreground timeout.
- Overriding is last-writer-wins: if another extension also registers `bash`
  under the same name, whichever loads later defines the tool.
- Only `bash` and `powershell` are affected. Other tools or MCP servers with
  their own timeout semantics are untouched.

## Test

```bash
bun test
```
