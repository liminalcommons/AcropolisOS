import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import { deriveDefaultBoard } from "@/lib/widgets/derive-board";

const ALL = () => true;

describe("deriveDefaultBoard — hostel ontology", () => {
  let onto: Ontology;
  beforeAll(async () => { onto = await loadOntology(path.resolve(__dirname, "../../ontology")); });

  it("emits a data_table per readable type with title + scalar columns", () => {
    const board = deriveDefaultBoard(onto, ALL);
    const guestTable = board.find((d) => d.kind === "data_table" && (d.config as { type: string }).type === "guest");
    expect(guestTable).toBeTruthy();
    const cols = (guestTable!.config as { columns: string[] }).columns;
    expect(cols).toContain("full_name");        // title_property first
    expect(cols).not.toContain("id");            // PK excluded
    expect(cols.length).toBeLessThanOrEqual(4);
  });

  it("emits a calendar for a type with a date/timestamp field", () => {
    const board = deriveDefaultBoard(onto, ALL);
    const cal = board.find((d) => d.kind === "calendar" && (d.config as { type: string }).type === "booking");
    expect(cal).toBeTruthy();
    expect((cal!.config as { date_field: string }).date_field).toBeTruthy();
  });

  it("admin board leads with the open-AgentBlocker veto-queue and a count metric per type", () => {
    const board = deriveDefaultBoard(onto, ALL, { admin: true });
    expect(board[0].kind).toBe("data_table");
    expect((board[0].config as { type: string }).type).toBe("agent_blocker");
    expect((board[0].config as { filter?: { field: string; value: string } }).filter).toEqual({ field: "status", value: "open" });
    expect(board.some((d) => d.kind === "metric" && (d.config as { type: string }).type === "member")).toBe(true);
    const vqCols = (board[0].config as { columns: string[] }).columns;
    expect(vqCols).toContain("id");            // row-id action target
    expect(vqCols).toContain("pathways");      // resolver choices source
    expect(vqCols).toContain("confirm_action");// confirm source
  });

  it("permission-filters: a viewer who can read nothing gets an empty board (floor)", () => {
    expect(deriveDefaultBoard(onto, () => false)).toEqual([]);
  });
});

describe("deriveDefaultBoard — NON-hostel litmus (book-club)", () => {
  let onto: Ontology;
  beforeAll(async () => { onto = await loadOntology(path.resolve(__dirname, "../../scenarios/book-club/ontology")); });

  it("derives over book-club types with zero hostel leakage", () => {
    const board = deriveDefaultBoard(onto, ALL);
    const types = board.map((d) => (d.config as { type: string }).type);
    expect(types).toContain("book");
    expect(types).toContain("reading_meeting");
    expect(types).not.toContain("bed");
    expect(types).not.toContain("guest");
    expect(board.some((d) => d.kind === "calendar" && (d.config as { type: string }).type === "reading_meeting")).toBe(true);
    const admin = deriveDefaultBoard(onto, ALL, { admin: true });
    expect(admin.some((d) => (d.config as { type: string }).type === "agent_blocker")).toBe(false);
  });
});
