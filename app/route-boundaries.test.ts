// loading.tsx and not-found.tsx are server components with NO hooks, so they can
// be invoked directly in node and must return a React element without throwing.
// (error.tsx / global-error.tsx use useEffect — they are verified LIVE in Step 7,
// since calling a hook outside a renderer throws "Invalid hook call".)
import { describe, it, expect } from "vitest";
import Loading from "./loading";
import NotFound from "./not-found";

describe("route boundaries — non-hook smoke", () => {
  it("loading default export renders an element", () => {
    expect(typeof Loading).toBe("function");
    expect(() => Loading()).not.toThrow();
    expect(Loading()).toBeTruthy();
  });
  it("not-found default export renders an element", () => {
    expect(typeof NotFound).toBe("function");
    expect(() => NotFound()).not.toThrow();
    expect(NotFound()).toBeTruthy();
  });
});
