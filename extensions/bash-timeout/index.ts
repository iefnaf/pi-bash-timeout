/**
 * pi-bash-timeout
 *
 * Replaces pi's built-in `bash`/`powershell` tools with same-name overrides
 * whose `timeout` parameter is in MILLISECONDS — the unit models are trained
 * on (Claude Code's Bash tool) — with a default of 120000 ms (2 min) and a
 * maximum of 600000 ms (10 min).
 *
 * Instead of guessing intent from magnitude, the override re-declares the tool:
 * the schema the model sees (and that arguments are validated against) states
 * the unit, the default, and the maximum, so a wrong unit or an over-max value
 * is rejected up front with a clear message rather than silently misread.
 * Execution delegates to pi's own implementation
 * (`createBashToolDefinition` / `createPowerShellToolDefinition`), converting
 * milliseconds to seconds — exactly, since pi accepts fractional seconds — at
 * the boundary, so streaming, truncation,
 * renderers, permissions, and other extensions' hooks keep working.
 *
 * Env overrides: PI_BASH_TIMEOUT_DEFAULT_MS, PI_BASH_TIMEOUT_MAX_MS
 */

import {
  createBashToolDefinition,
  createPowerShellToolDefinition,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { msToSeconds, policyFromEnv, type TimeoutPolicy } from "./core.ts";

/** Shell settings keys, mirroring how the session constructs its own bash tool. */
interface ShellSettings {
  shellPath?: string;
  shellCommandPrefix?: string;
}

/** Render args with the timeout shown in seconds, as the inherited renderer assumes. */
function displaySeconds(base: { renderCall?: (args: any, theme: any, context: any) => any }) {
  return (args: any, theme: any, context: any) => {
    const display = args?.timeout === undefined ? args : { ...args, timeout: msToSeconds(args.timeout) };
    return base.renderCall!(display, theme, context);
  };
}

export default function (pi: ExtensionAPI) {
  const policy = policyFromEnv(process.env);

  const parameters = Type.Object({
    command: Type.String({ description: "Shell command to execute" }),
    timeout: Type.Optional(
      Type.Number({
        description:
          `Optional timeout for the command in milliseconds. ` +
          `Default ${policy.defaultMs} ms (${msToSeconds(policy.defaultMs)}s); ` +
          `maximum ${policy.maxMs} ms (${msToSeconds(policy.maxMs)}s).`,
        minimum: 1,
        maximum: policy.maxMs,
      }),
    ),
  });

  function description(shellName: string): string {
    return (
      `Execute a ${shellName} command in the current working directory. Returns stdout and stderr. ` +
      `Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). ` +
      `If truncated, full output is saved to a temp file. ` +
      `Optionally provide a timeout in milliseconds (default ${policy.defaultMs} ms, max ${policy.maxMs} ms).`
    );
  }

  // The model sees milliseconds; pi executes seconds (fractional values are
  // fine — its backend multiplies by 1000 for setTimeout). The default applies
  // when the call omits `timeout` (pi itself would arm no timer at all).
  const toSeconds = (timeoutMs: number | undefined) => msToSeconds(timeoutMs ?? policy.defaultMs);

  // pi's own bash definition, rebuilt once settings become readable
  // (pi.getSettings() throws while the extension is still loading). Held by
  // reference: resolving the tool by name would recurse into this override.
  let bashBase = createBashToolDefinition(process.cwd());
  let bashTuned = false;
  const tuneBash = () => {
    if (bashTuned) return;
    bashTuned = true;
    try {
      const settings = pi.getSettings() as ShellSettings | undefined;
      if (settings?.shellPath || settings?.shellCommandPrefix) {
        bashBase = createBashToolDefinition(process.cwd(), {
          shellPath: settings.shellPath,
          commandPrefix: settings.shellCommandPrefix,
        });
      }
    } catch {
      // Settings unavailable: pi's defaults already apply.
    }
  };

  pi.registerTool({
    ...bashBase, // renderers, outputSchema, prompt snippet/guidelines, constrained sampling
    description: description("bash"),
    parameters,
    renderCall: displaySeconds(bashBase),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      tuneBash();
      return bashBase.execute(
        toolCallId,
        { command: params.command, timeout: toSeconds(params.timeout) },
        signal,
        onUpdate,
        ctx,
      );
    },
    // No renderResult override: the inherited one has no timeout to display.
  });

  const powershellBase = createPowerShellToolDefinition(process.cwd());
  pi.registerTool({
    ...powershellBase,
    description: description("PowerShell"),
    parameters,
    renderCall: displaySeconds(powershellBase),
    // Registering a tool activates it; powershell is not in pi's default
    // toolset, so keep it inactive unless the user enabled it themselves.
    defaultActive: false,
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return powershellBase.execute(
        toolCallId,
        { command: params.command, timeout: toSeconds(params.timeout) },
        signal,
        onUpdate,
        ctx,
      );
    },
  });
}
