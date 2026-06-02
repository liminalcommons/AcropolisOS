// bug_resolve_orderby — dedup candidate ranking must be deterministic.
//
// findDuplicates pulled candidate rows with an UNORDERED
// `SELECT ... LIMIT 2000`, then sorted them by score descending only. For rows
// that tie on score the final top-5 slice depended on the DB's physical row
// order (heap scan order), which can change across runs/inserts — so the same
// proposal could surface different "duplicates" run to run.
//
// Two fixes, asserted here:
//   1. the SQL carries ORDER BY "id" ASC so the DB returns rows deterministically
//   2. the in-process comparator tie-breaks equal scores by id, so the ranking is
//      stable even if rows arrive in a different order.

import { describe, expect, it } from "vitest";
import { getRuntimeOntologyDir } from "../setup/paths";
import { loadOntology } from "../ontology/load";
import { resolveTargetTable } from "./target-table";
import { deriveKeyFields } from "../widgets/vocabulary";
import { findDuplicates } from "./resolve";
import type { Database } from "../db/client";

// A db stub whose execute() returns a fixed row set and records the SQL it ran.
function stubDb(rows: Array<Record<string, unknown>>): {
  db: Database;
  sqls: string[];
} {
  const sqls: string[] = [];
  const db = {
    execute: async (query: unknown) => {
      // drizzle sql.raw carries the literal text on queryChunks[].value[] —
      // pull it out as readable SQL (avoids JSON escaping of the quotes).
      const chunks =
        (query as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ??
        [];
      const text = chunks
        .map((c) => (Array.isArray(c.value) ? c.value.join("") : ""))
        .join(" ");
      sqls.push(text || JSON.stringify(query));
      return rows;
    },
  } as unknown as Database;
  return { db, sqls };
}

describe("findDuplicates — deterministic candidate ranking", () => {
  it("emits ORDER BY id and ranks tie-scored candidates by id, regardless of arrival order", async () => {
    const ontology = await loadOntology(getRuntimeOntologyDir());
    // guest: title_property full_name + email (ref) → an email key field.
    // resolveTargetTable takes the snake_case token; objectType is PascalCase.
    const resolved = resolveTargetTable(ontology, "guest");
    expect(resolved).not.toBeNull();
    const objectType = resolved!.objectType;
    const labelField = ontology.object_types[objectType].title_property ?? "id";
    const keyFields = deriveKeyFields(ontology, objectType);
    const matchField = keyFields.includes("email") ? "email" : keyFields[0];
    expect(matchField).toBeTruthy();

    // Three rows that all tie on the same matchField value (same score).
    const mkRow = (id: string) => ({
      id,
      [labelField]: `Same ${id}`,
      [matchField]: "tie@example.com",
    });
    const incoming = { [matchField]: "tie@example.com" };

    // Same rows, two DIFFERENT arrival orders.
    const orderA = [mkRow("c"), mkRow("a"), mkRow("b")];
    const orderB = [mkRow("b"), mkRow("c"), mkRow("a")];

    const a = stubDb(orderA);
    const b = stubDb(orderB);

    const resA = await findDuplicates(a.db, resolved!, ontology, incoming);
    const resB = await findDuplicates(b.db, resolved!, ontology, incoming);

    expect(resA.length).toBeGreaterThanOrEqual(3);

    // SQL carries the deterministic ORDER BY id.
    expect(a.sqls[0]).toMatch(/ORDER BY\s+"id"\s+ASC/i);

    // Same candidates, same order across the two runs (tie-broken by id).
    expect(resA.map((c) => c.id)).toEqual(resB.map((c) => c.id));
    // And specifically id-ascending for the tie.
    expect(resA.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
