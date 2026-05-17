import { beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryInboxStore } from "@/lib/inbox/store";

const store = new InMemoryInboxStore();

vi.mock("@/lib/inbox/singleton", () => ({
  getInboxStore: () => store,
}));

const { POST } = await import("./route");

function makeFormReq(files: { name: string; type: string; body: string }[]): Request {
  const fd = new FormData();
  for (const f of files) {
    fd.append("files", new File([f.body], f.name, { type: f.type }));
  }
  return new Request("http://localhost/api/inbox/upload", {
    method: "POST",
    body: fd,
  });
}

describe("POST /api/inbox/upload", () => {
  beforeEach(async () => {
    // Drain the in-memory store between tests by re-instantiating.
    (store as unknown as { items: unknown[] }).items = [];
  });

  it("returns 400 when no files are attached", async () => {
    const fd = new FormData();
    const req = new Request("http://localhost/api/inbox/upload", {
      method: "POST",
      body: fd,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("ingests a CSV as one inbox row per data row", async () => {
    const req = makeFormReq([
      { name: "people.csv", type: "text/csv", body: "name\nada\nlin\n" },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { inboxIds: string[]; count: number };
    expect(body.count).toBe(2);
    expect(body.inboxIds).toHaveLength(2);

    const items = await store.list();
    expect(items).toHaveLength(2);
    expect(items[0].source_filename).toBe("people.csv");
    expect(items[0].mime_type).toBe("text/csv");
    expect(items[0].payload).toEqual({ name: "ada" });
    expect(items[0].claimed_by_proposal_id).toBeNull();
  });

  it("ingests a JSON array as one inbox row per element", async () => {
    const req = makeFormReq([
      {
        name: "items.json",
        type: "application/json",
        body: '[{"k":1},{"k":2},{"k":3}]',
      },
    ]);
    const res = await POST(req);
    const body = (await res.json()) as { inboxIds: string[]; count: number };
    expect(body.count).toBe(3);
    const items = await store.list();
    expect(items.map((i) => i.payload)).toEqual([{ k: 1 }, { k: 2 }, { k: 3 }]);
  });

  it("ingests a Markdown file as a single row with parsed frontmatter", async () => {
    const req = makeFormReq([
      {
        name: "note.md",
        type: "text/markdown",
        body: "---\ntitle: Welcome\n---\nHello.\n",
      },
    ]);
    const res = await POST(req);
    const body = (await res.json()) as { inboxIds: string[]; count: number };
    expect(body.count).toBe(1);
    const items = await store.list();
    expect(items[0].payload).toEqual({
      frontmatter: { title: "Welcome" },
      body: "Hello.\n",
    });
  });

  it("ingests multiple files in a single request", async () => {
    const req = makeFormReq([
      { name: "a.csv", type: "text/csv", body: "x\n1\n2\n" },
      { name: "b.json", type: "application/json", body: '{"hi":true}' },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { inboxIds: string[]; count: number };
    expect(body.count).toBe(3);
    expect(body.inboxIds).toHaveLength(3);
  });

  it("returns 415 when a file's type is unsupported", async () => {
    const req = makeFormReq([
      { name: "x.bin", type: "application/x-blob", body: "abc" },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/unsupported/i);
    expect(await store.list()).toEqual([]);
  });

  it("returns 400 when an individual file fails to parse", async () => {
    const req = makeFormReq([
      { name: "broken.json", type: "application/json", body: "{not json" },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await store.list()).toEqual([]);
  });
});
