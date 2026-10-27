# pi-bash-timeout

pi's `bash` tool takes `timeout` in **seconds**, has no default, and accepts values up to ~24.8 days. Models trained on millisecond APIs (Claude Code, Playwright) often pass `60000` meaning one minute; pi runs that as 16.7 hours, and a hung command blocks the session overnight.

This extension fixes the value before the command runs:

| Model passes | Runs with | Note to model |
|---|---|---|
| nothing | 120s | only if it timed out |
| `30` | 30s | — |
| `90000` (≥ 10000) | 90s (treated as ms) | yes |
| `3600` | 1800s (capped) | yes |
| `0`, `-1`, `"60"` | unchanged, pi rejects it | — |

It hooks `tool_call` and mutates `input.timeout` in place instead of re-registering `bash`, so the built-in tool, its renderer, other extensions, and bash calls made from codemode scripts all keep working. Applies to `bash` and `powershell`.

## Install

```bash
pi install /path/to/pi-bash-timeout
# or try it once
pi -e /path/to/pi-bash-timeout
```

## Configure

| Env var | Default |
|---|---|
| `PI_BASH_TIMEOUT_DEFAULT` | `120` |
| `PI_BASH_TIMEOUT_MAX` | `1800` |
| `PI_BASH_TIMEOUT_MS_THRESHOLD` | `10000` |

## Test

```bash
bun test
```
