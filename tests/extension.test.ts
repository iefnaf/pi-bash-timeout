import { describe, expect, it } from "bun:test";
import { Value } from "typebox/value";
import extension from "../extensions/bash-timeout/index.ts";

/** Load the extension with the given env, returning the tools it registered. */
function load(env: Record<string, string | undefined> = {}) {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const tools = new Map<string, any>();
    extension({
      registerTool: (tool: any) => tools.set(tool.name, tool),
      getSettings: () => ({}),
    } as any);
    return tools;
  } finally {
    process.env = saved;
  }
}

describe("override registration", () => {
  it("registers bash and powershell under their built-in names", () => {
    const tools = load();
    expect(tools.has("bash")).toBe(true);
    expect(tools.has("powershell")).toBe(true);
  });

  it("declares timeout in milliseconds with a default and a maximum", () => {
    const bash = load().get("bash")!;
    const timeout = bash.parameters.properties.timeout;
    expect(timeout.maximum).toBe(600_000);
    expect(timeout.minimum).toBe(1);
    expect(timeout.description).toContain("milliseconds");
    expect(timeout.description).toContain("120000");
    expect(bash.description).toContain("milliseconds");
  });

  it("keeps powershell out of the default toolset", () => {
    const tools = load();
    expect(tools.get("bash")!.defaultActive).toBeUndefined();
    expect(tools.get("powershell")!.defaultActive).toBe(false);
  });

  it("validates the schema the model will be held to", () => {
    const schema = load().get("bash")!.parameters;
    expect(Value.Check(schema, { command: "ls" })).toBe(true); // timeout optional
    expect(Value.Check(schema, { command: "ls", timeout: 60_000 })).toBe(true);
    expect(Value.Check(schema, { command: "ls", timeout: 700_000 })).toBe(false); // over max
    expect(Value.Check(schema, { command: "ls", timeout: 0 })).toBe(false); // non-positive
    expect(Value.Check(schema, { command: "ls", timeout: "60" })).toBe(false); // wrong type
  });
});

describe("bash execute (delegates to pi's own implementation)", () => {
  it("runs a command and reports its exit code", async () => {
    const bash = load().get("bash")!;
    const result = await bash.execute("t1", { command: "echo hello-ms" }, undefined, undefined, undefined);
    expect(result.structuredContent.exit_code).toBe(0);
    expect(result.content[0].text).toContain("hello-ms");
  });

  it("treats timeout as milliseconds", async () => {
    const bash = load().get("bash")!;
    // 1200 ms must mean ~1 second, not the 20 minutes pi used to wait.
    await expect(
      bash.execute("t2", { command: "sleep 5", timeout: 1_200 }, undefined, undefined, undefined),
    ).rejects.toThrow(/timed out after 1 seconds/);
  });

  it("applies the default timeout when the call omits it", async () => {
    const bash = load({ PI_BASH_TIMEOUT_DEFAULT_MS: "1000" }).get("bash")!;
    await expect(
      bash.execute("t3", { command: "sleep 5" }, undefined, undefined, undefined),
    ).rejects.toThrow(/timed out after 1 seconds/);
  });
});
