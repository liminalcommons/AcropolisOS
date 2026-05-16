import { describe, expect, it } from "vitest";
import { testEcho, TEST_ECHO_EVENT } from "./test-echo";

describe("testEcho function", () => {
  it("exposes the canonical test event name", () => {
    expect(TEST_ECHO_EVENT).toBe("acropolisos/test.echo");
  });

  it("is registered with a stable id", () => {
    expect(testEcho.id()).toBe("acropolisos-test-echo");
  });

  it("echoes the event payload back", async () => {
    const payload = { hello: "world", n: 42 };
    const result = await runHandler(testEcho, {
      name: TEST_ECHO_EVENT,
      data: payload,
    });
    expect(result).toEqual({ echoed: payload });
  });
});

type AnyFn = { fn: (ctx: unknown) => unknown };
async function runHandler(
  fn: unknown,
  event: { name: string; data: unknown },
): Promise<unknown> {
  const handler = (fn as AnyFn).fn;
  if (typeof handler !== "function") {
    throw new Error("inngest function did not expose a handler under .fn");
  }
  const noopStep = {
    run: async (_id: string, cb: () => unknown) => cb(),
  };
  return handler({ event, step: noopStep });
}
