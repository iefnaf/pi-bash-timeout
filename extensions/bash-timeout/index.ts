/**
 * pi-bash-timeout
 *
 * Fixes the bash tool's timeout before it runs, without replacing the tool:
 * - omitted timeout   -> default (120s)
 * - >= 10000          -> treated as milliseconds, divided by 1000
 * - above the maximum -> capped (1800s)
 *
 * Works through the `tool_call` hook (mutating `event.input` in place), so it
 * composes with other extensions and also covers bash calls made from codemode.
 * When it changed something the model should know about, it appends a note to
 * the tool result.
 *
 * Env overrides: PI_BASH_TIMEOUT_DEFAULT, PI_BASH_TIMEOUT_MAX, PI_BASH_TIMEOUT_MS_THRESHOLD
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { noteFor, normalizeTimeout, policyFromEnv, type TimeoutDecision } from "./core.ts";

const SHELL_TOOLS = new Set(["bash", "powershell"]);

export default function (pi: ExtensionAPI) {
  const policy = policyFromEnv(process.env);
  const pending = new Map<string, TimeoutDecision>();

  pi.on("tool_call", (event) => {
    if (!SHELL_TOOLS.has(event.toolName)) return;
    const input = event.input as { timeout?: unknown };
    const decision = normalizeTimeout(input.timeout, policy);
    if (!decision.changed) return;
    input.timeout = decision.timeout;
    pending.set(event.toolCallId, decision);
  });

  pi.on("tool_result", (event) => {
    const decision = pending.get(event.toolCallId);
    if (!decision) return;
    pending.delete(event.toolCallId);

    const timedOut = event.isError && event.content.some(
      (c) => c.type === "text" && c.text.includes("timed out after"),
    );
    const note = noteFor(decision, policy, timedOut);
    if (!note) return;
    return {
      content: [...event.content, { type: "text" as const, text: note }],
      structuredContent: event.structuredContent,
    };
  });

  pi.on("session_shutdown", () => {
    pending.clear();
  });
}
