// compose.test.ts — resolveDashboard SURFACES validation errors.
//
// resolveDashboard reads member_context.pinned_widgets and resolves each
// descriptor through the read-only api. Before this change an invalid stored
// config (e.g. referencing a type the ontology no longer has) was silently
// skipped (`if (!validation.ok) continue;`), so a steward whose pinned view
// broke saw the widget vanish with no signal. This pins the new contract: an
// invalid descriptor is returned as a ResolvedWidget with data:null +
// validation_error, never dropped.
//
// DB-free: a stub db returns exactly one pinned descriptor (the pinned_widgets
// JSON read), and the descriptor fails validateWidgetConfig — so resolution
// short-circuits at validation, never reaching createReadOnlyDataApi/SQL.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { resolveDashboard } from "@/lib/widgets/compose";
import type { Database } from "@/lib/db/client";

const SMALL = path.resolve(__dirname, "..", "..", "scenarios", "small-community", "ontology");

// Stub db whose only used surface is the pinned_widgets read:
//   db.select({pinned_widgets}).from(member_context).where(...).limit(1)
// We return one stored descriptor carrying an INVALID config.
function makePinnedDb(pinned: unknown[]): Database {
  const rows = [{ pinned_widgets: JSON.stringify(pinned) }];
  const stub = {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve(rows);
                },
              };
            },
          };
        },
      };
    },
  };
  return stub as unknown as Database;
}

describe("resolveDashboard — returns validation_error instead of dropping a stale widget", () => {
  const prev = process.env.ACROPOLISOS_ONTOLOGY_DIR;
  beforeAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = SMALL;
  });
  afterAll(() => {
    process.env.ACROPOLISOS_ONTOLOGY_DIR = prev;
  });

  it("returns a widget with validation_error when config fails validation, not undefined/dropped", async () => {
    const db = makePinnedDb([
      { id: "stale", kind: "data_table", config: { type: "deleted_type", columns: ["x"] } },
    ]);

    const out = await resolveDashboard(db, "member-1", () => true);

    expect(out).toHaveLength(1); // NOT dropped
    const w = out[0];
    expect(w).toBeDefined();
    expect(w.validation_error).toBeTruthy();
    expect(w.validation_error?.kind).toBe("unknown_type");
    expect(w.data).toBeNull();
  });

  it("gracefully handles validation_error in JSON serialization (no circular refs)", async () => {
    const db = makePinnedDb([
      { id: "stale", kind: "data_table", config: { type: "deleted_type", columns: ["x"] } },
    ]);
    const out = await resolveDashboard(db, "member-1", () => true);
    expect(() => JSON.stringify(out[0])).not.toThrow();
  });
});
