import { describe, expect, it } from "bun:test";
import extension from "../extensions/bash-timeout/index.ts";

type Handler = (event: any, ctx?: any) => any;

function load() {
  const handlers = new Map<string, Handler>();
  extension({ on: (name: string, h: Handler) => handlers.set(name, h) } as any);
  const call = (toolCallId: string, toolName: string, input: Record<string, unknown>) =>
    handlers.get("tool_call")!({ type: "tool_call", toolCallId, toolName, input });
  const result = (toolCallId: string, input: Record<string, unknown>, text: string, isError = false) =>
    handlers.get("tool_result")!({
      type: "tool_result", toolCallId, toolName: "bash", input,
      content: [{ type: "text", text }], structuredContent: { output: text }, isError,
    });
  return { call, result };
}

describe("extension hooks", () => {
  it("rewrites a millisecond timeout and annotates the result", () => {
    const { call, result } = load();
    const input = { command: "ego-browser nodejs", timeout: 90_000 };
    expect(call("a", "bash", input)).toBeUndefined(); // not blocked
    expect(input.timeout).toBe(90);
    const r = result("a", input, "ok");
    expect(r.content).toHaveLength(2);
    expect(r.content[1].text).toContain("milliseconds");
    expect(r.structuredContent).toEqual({ output: "ok" });
  });

  it("injects the default and stays silent on success", () => {
    const { call, result } = load();
    const input: Record<string, unknown> = { command: "ls" };
    call("b", "bash", input);
    expect(input.timeout).toBe(120);
    expect(result("b", input, "ok")).toBeUndefined();
  });

  it("explains the default when the command timed out", () => {
    const { call, result } = load();
    const input: Record<string, unknown> = { command: "sleep 999" };
    call("c", "bash", input);
    const r = result("c", input, "Command timed out after 120 seconds", true);
    expect(r.content[1].text).toContain("default 120s");
  });

  it("ignores other tools and sane values", () => {
    const { call, result } = load();
    const readInput = { path: "x", timeout: 90_000 };
    call("d", "read", readInput);
    expect(readInput.timeout).toBe(90_000);
    const ok = { command: "ls", timeout: 30 };
    call("e", "bash", ok);
    expect(ok.timeout).toBe(30);
    expect(result("e", ok, "ok")).toBeUndefined();
  });
});
