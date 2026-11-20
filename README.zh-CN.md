# pi-bash-timeout

[English](README.md) | **简体中文**

一个 [pi](https://github.com/earendil-works/pi) 扩展，让 `bash` 和 `powershell` 工具的 `timeout` 参数跟 Claude Code 的 Bash 工具保持一致：

- **单位是毫秒。** `30000` 就是 30 秒。
- **默认 120000 ms（2 分钟）。** 模型没传 `timeout` 时使用默认值。
- **最大 600000 ms（10 分钟）。** 超过上限会被 schema 校验拒绝，模型会换一个更小的值重试。

不装这个扩展时，pi 把 `timeout` 当成**秒**，而且**没有默认值**。所以 `timeout: 60000` 会等 16.7 小时，不传 timeout 的调用则可能永远卡住。详见[为什么需要它](#为什么需要它)。

## 安装

```bash
pi install npm:pi-bash-timeout
```

新开的 pi 会话自动生效；已经在运行的会话执行 `/reload` 即可。

## 配置

没有配置文件。可以用两个环境变量调整，在会话启动时读取一次：

| 环境变量 | 默认值 | 含义 |
|---|---|---|
| `PI_BASH_TIMEOUT_DEFAULT_MS` | `120000` | 模型没传 `timeout` 时使用的超时 |
| `PI_BASH_TIMEOUT_MAX_MS` | `600000` | schema 允许的最大超时 |

例如把上限放宽到 30 分钟：

```bash
export PI_BASH_TIMEOUT_MAX_MS=1800000
pi
```

## 行为

| 模型传入 | 结果 |
|---|---|
| 不传 | 使用默认值 120000 ms |
| `30000` | 30 秒 |
| `5000` | 5 秒 |
| `600001` 及以上 | schema 校验拒绝；模型看到报错后重试 |
| `0`、`-1`、`"60"` | schema 校验拒绝 |

`powershell` 也做了同样的处理。它默认不启用，需要你自己打开，比如用 `--tools powershell` 或 `defaultTools` 设置。

## 为什么需要它

pi 内置的 `bash` 工具按秒换算 `timeout`，并且没有默认值：

```ts
// @earendil-works/pi-coding-agent dist/core/tools/bash.js
function resolveTimeoutMs(timeout) {
  if (timeout === undefined) return undefined;   // 完全不设定时器
  const timeoutMs = timeout * 1000;              // 按秒处理
  if (timeoutMs > MAX_TIMEOUT_MS) throw ...;     // 只检查 int32 溢出（约 24.8 天）
  return timeoutMs;
}
```

这带来两个问题。

**1. 没有默认值。** 模型不传 `timeout` 时，一条卡住的命令会让会话永远阻塞，比如等待交互输入、守护进程卡死、没有客户端超时的网络请求。我们曾经让 agent 通宵跑构建，第二天早上发现它卡在午夜前开始的一条命令上。

**2. 模型习惯写毫秒。** Claude Code 的 Bash 工具、Playwright、`setTimeout` 用的都是毫秒，模型会把这个习惯带过来。真实会话日志里出现过下面这些值，pi 全部按秒接受了：

| 模型写的 | 本意 | pi 实际等待 |
|---|---|---|
| `10000` | 10 秒 | 2.8 小时 |
| `60000` | 1 分钟 | 16.7 小时 |
| `120000` | 2 分钟 | 33.3 小时 |
| `600000` | 10 分钟 | 7 天 |

整个过程不会报错，调用看起来只是一直在忙。

这个问题在上游被反馈过多次（earendil-works/pi #9785、#9151、#1335、#9460、#8857、#5484）。维护者在 #1335 里的立场是 *"the agent is supposed to set a timeout for long running tasks"*（应该由 agent 自己给长时间任务设置超时）。按照 pi 保持核心精简的设计，这类策略应该放在扩展里实现。

## 实现原理

扩展注册了名为 `bash` 和 `powershell` 的工具。用内置工具的名字注册会覆盖内置工具，这是 pi 文档里写明的覆盖机制。每个覆盖工具：

1. 基于 pi 自己的定义（`createBashToolDefinition` / `createPowerShellToolDefinition`），所以输出、渲染和提示词片段都和原来一样；
2. 只重新声明 `timeout`，把单位、默认值和上限写进 schema；
3. 在 `execute` 里补上默认值，把毫秒精确换算成秒（pi 支持小数秒），再调用 pi 的原始实现。

因为工具名没变，其他扩展的 `tool_call` 钩子（权限控制、日志）看到的仍然是 `bash`。`codemode` 里的 `tools.bash` 同样使用毫秒，你的 `shellPath` / `shellCommandPrefix` 设置也照常生效。

v0.1 根据数值大小猜单位（`>= 10000` 视为毫秒），但一个裸数字本身没有单位：本意是 5 秒的 `5000` 会被当成 5000 秒。v0.2 不再猜测，而是把单位直接写进 schema。

## 局限

- **超过上限会被拒绝，而不是截断。** 这与 Claude Code 一致。开发服务器、watcher 这类长时间运行的进程应该放到后台并轮询，而不是挂在前台调用里。
- **后注册的生效。** 如果另一个扩展也注册了 `bash`，后加载的那个会决定最终的工具定义。
- **只影响 `bash` 和 `powershell`。** 其他工具和 MCP 服务器保持各自的超时行为。

## 开发

```bash
bun install
bun test
```

## 许可证

MIT
