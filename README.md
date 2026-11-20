# pi-bash-timeout

**English** | [简体中文](https://github.com/iefnaf/pi-bash-timeout/blob/master/README.zh-CN.md)

A [pi](https://github.com/earendil-works/pi) extension that makes the `timeout` parameter of the `bash` and `powershell` tools work like Claude Code's Bash tool:

- **Unit is milliseconds.** `30000` means 30 seconds.
- **Default 120000 ms (2 min).** The default applies when the model leaves `timeout` out.
- **Max 600000 ms (10 min).** Larger values fail schema validation, and the model retries with a smaller one.

Without this extension, pi reads `timeout` as **seconds** and sets **no default**. So `timeout: 60000` waits 16.7 hours, and a call with no timeout can hang forever. See [Why](#why) for details.

## Install

```bash
pi install npm:pi-bash-timeout
```

It takes effect in new pi sessions. In a session that's already running, use `/reload`.

## Configure

There's no config file. Two optional environment variables are read once at session start:

| Env var | Default | Meaning |
|---|---|---|
| `PI_BASH_TIMEOUT_DEFAULT_MS` | `120000` | Timeout used when the model omits `timeout` |
| `PI_BASH_TIMEOUT_MAX_MS` | `600000` | Largest timeout the schema accepts |

For example, to allow up to 30 minutes:

```bash
export PI_BASH_TIMEOUT_MAX_MS=1800000
pi
```

## Behavior

| Model passes | Result |
|---|---|
| nothing | 120000 ms default applies |
| `30000` | 30 seconds |
| `5000` | 5 seconds |
| `600001` or more | rejected by schema validation; the model sees the error and retries |
| `0`, `-1`, `"60"` | rejected by schema validation |

`powershell` gets the same treatment. It stays inactive unless you enable it yourself, for example with `--tools powershell` or the `defaultTools` setting.

## Why

pi's built-in `bash` tool converts `timeout` from seconds and has no default:

```ts
// @earendil-works/pi-coding-agent dist/core/tools/bash.js
function resolveTimeoutMs(timeout) {
  if (timeout === undefined) return undefined;   // no timer at all
  const timeoutMs = timeout * 1000;              // treated as seconds
  if (timeoutMs > MAX_TIMEOUT_MS) throw ...;     // only int32 overflow is checked (~24.8 days)
  return timeoutMs;
}
```

This causes two problems.

**1. No default.** When the model omits `timeout`, a hung command blocks the session forever. Causes include an interactive prompt, a stuck daemon, or a network call with no client timeout. We once left an agent building overnight and found it in the morning, stuck on one command that started before midnight.

**2. Models write milliseconds.** Claude Code's Bash tool, Playwright, and `setTimeout` all take milliseconds, and models carry that habit over. Real session logs show values like these, all accepted by pi as seconds:

| Model wrote | Intended | pi actually waits |
|---|---|---|
| `10000` | 10 s | 2.8 hours |
| `60000` | 1 min | 16.7 hours |
| `120000` | 2 min | 33.3 hours |
| `600000` | 10 min | 7 days |

Nothing reports an error. The call just looks busy.

The problem has been reported upstream several times (earendil-works/pi #9785, #9151, #1335, #9460, #8857, #5484). The maintainer's position on #1335 is that *"the agent is supposed to set a timeout for long running tasks"*. In keeping with pi's minimal-core design, this kind of policy belongs in an extension.

## How it works

The extension registers tools named `bash` and `powershell`. Registering a tool with a built-in's name overrides the built-in; this is pi's documented override mechanism. Each override:

1. starts from pi's own definition (`createBashToolDefinition` / `createPowerShellToolDefinition`), so output, rendering and prompt snippets stay the same;
2. redeclares only `timeout`, with the unit, default and max written into the schema;
3. in `execute`, fills in the default, converts milliseconds to seconds exactly (pi accepts fractional seconds), and calls pi's implementation.

Because the tool name doesn't change, other extensions' `tool_call` hooks (permission gates, loggers) still see `bash`. `codemode`'s `tools.bash` also uses milliseconds, and your `shellPath` / `shellCommandPrefix` settings still apply.

v0.1 guessed the unit from the number's size (`>= 10000` meant milliseconds), but a bare number has no unit: `5000` meaning 5 s was read as 5000 s. v0.2 drops the guessing and puts the unit in the schema instead.

## Limitations

- **Over-max values are rejected, not capped.** This matches Claude Code. Long-running processes such as dev servers and watchers should run in the background and be polled, not held in a foreground call.
- **Last writer wins.** If another extension also registers `bash`, the one that loads later defines the tool.
- **Only `bash` and `powershell` change.** Other tools and MCP servers keep their own timeout behavior.

## Development

```bash
bun install
bun test
```

## License

MIT
