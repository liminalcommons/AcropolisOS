import { describe, expect, it } from "vitest";
import { resolveApprovedViews } from "./resolve";
import { InMemoryApprovedViewsRegistry, type ApprovedViewDescriptor } from "./registry";

const orgView: ApprovedViewDescriptor = { id: "o", kind: "metric", config: { type: "member", agg: "count" } };
const roleView: ApprovedViewDescriptor = { id: "r", kind: "data_table", config: { type: "booking", columns: ["from_date"] } };
const viewerView: ApprovedViewDescriptor = { id: "v", kind: "roster", config: { type: "member", fields: ["handle"] } };

describe("resolveApprovedViews", () => {
  it("concatenates org + role + viewer scopes in that order", async () => {
    const reg = new InMemoryApprovedViewsRegistry();
    await reg.upsert({ scope: "org", scope_key: "" }, [orgView], "x");
    await reg.upsert({ scope: "role", scope_key: "steward" }, [roleView], "x");
    await reg.upsert({ scope: "viewer", scope_key: "m-1" }, [viewerView], "x");
    const out = await resolveApprovedViews(
      reg,
      { id: "m-1", role: "steward" },
      () => true,
    );
    expect(out.map((d) => d.id)).toEqual(["o", "r", "v"]);
  });

  it("drops a descriptor whose type is not readable (fail-closed)", async () => {
    const reg = new InMemoryApprovedViewsRegistry();
    await reg.upsert({ scope: "org", scope_key: "" }, [orgView, roleView], "x");
    const canReadType = (t: string) => t === "member"; // booking denied
    const out = await resolveApprovedViews(reg, { id: "m-1", role: "steward" }, canReadType);
    expect(out.map((d) => d.id)).toEqual(["o"]);
  });

  it("returns [] when no scopes have rows", async () => {
    const reg = new InMemoryApprovedViewsRegistry();
    const out = await resolveApprovedViews(reg, { id: "m-9", role: "member" }, () => true);
    expect(out).toEqual([]);
  });
});
