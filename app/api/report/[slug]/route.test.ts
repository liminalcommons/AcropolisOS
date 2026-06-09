// Locks the SECURITY CONTRACT of the public report route: the slug must be
// sanitized so no request can read outside uploads/reports/. (Behaviour was also
// integration-verified live by the AUDITOR via curl; this is the regression lock.)
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));
import { readFile } from "node:fs/promises";
import { GET } from "./route";

function call(slug: string) {
  return GET(new Request(`http://x/api/report/${slug}`), {
    params: Promise.resolve({ slug }),
  });
}

describe("public report route — slug safety", () => {
  beforeEach(() => vi.mocked(readFile).mockReset());

  const unsafe = ["../../.env", "Foo.bar", "a/b", "..%2f.env", "", "UPPER", "a.b", "x/../y", ".env", "a b"];
  it.each(unsafe)("404s unsafe slug %j WITHOUT touching the filesystem", async (slug) => {
    const res = await call(slug);
    expect(res.status).toBe(404);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("404s a safe slug whose file is missing (no crash/leak)", async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error("ENOENT"));
    const res = await call("uxui-foundation");
    expect(res.status).toBe(404);
  });

  it("serves a safe slug's html as text/html, no-store", async () => {
    vi.mocked(readFile).mockResolvedValueOnce("<h1>hi</h1>");
    const res = await call("my-report-1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.text()).toBe("<h1>hi</h1>");
  });
});
