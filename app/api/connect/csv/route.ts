// A5: /api/connect/csv — server-side CSV ingest into raw_inbox.
//
// Accepts a raw CSV text body (Content-Type: text/plain or text/csv) OR
// a JSON body { csv: "<text>" }. Parses the header row as keys; each
// subsequent row becomes ONE raw_inbox row with source='csv-upload' and
// payload = { header: value, ... }.
//
// Auth-gated (steward or authenticated member) — mirrors /api/connect/upload.
// No external CSV dep — hand-rolled parser handles quoted fields.
//
// Body: text/plain OR text/csv (raw CSV) OR application/json { csv: string }
// Response: { ok: true, count: number, ids: string[] } | { error: string }

import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Minimal CSV parser (quoted-field-aware) ───────────────────────────────────
// Handles: commas in quoted fields, double-quote escapes inside quoted fields.
// Does NOT handle: multiline quoted fields, BOM, non-comma delimiters.

function parseCSVLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        // Check for escaped double-quote ("")
        if (line[i + 1] === '"') {
          cur += '"';
          i++; // skip second quote
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur.trim());
  return cells;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCSVLine(line);
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = cells[i] ?? "";
    }
    rows.push(row);
  }
  return rows;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  // Auth gate — any authenticated member may push data.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Accept raw CSV text OR JSON { csv: string }
  const contentType = req.headers.get("content-type") ?? "";
  let csvText: string;

  if (contentType.includes("application/json")) {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const parsed = z.object({ csv: z.string().min(1) }).safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues.map((i) => i.message).join("; ") },
        { status: 400 },
      );
    }
    csvText = parsed.data.csv;
  } else {
    // Treat body as raw text (text/csv or text/plain)
    try {
      csvText = await req.text();
    } catch {
      return Response.json({ error: "failed_to_read_body" }, { status: 400 });
    }
    if (!csvText.trim()) {
      return Response.json({ error: "empty_body" }, { status: 400 });
    }
  }

  // Parse CSV
  let rows: Record<string, string>[];
  try {
    rows = parseCSV(csvText);
  } catch (err) {
    return Response.json(
      { error: "csv_parse_error", detail: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }

  if (rows.length === 0) {
    return Response.json({ error: "no_data_rows" }, { status: 422 });
  }

  // Insert all rows into raw_inbox with source='csv-upload'
  const db = getDb();
  const inserted = await db
    .insert(raw_inbox)
    .values(rows.map((payload) => ({ source: "csv-upload", payload })))
    .returning({ id: raw_inbox.id });

  const ids = inserted.map((r) => r.id);

  return Response.json({ ok: true, count: ids.length, ids }, { status: 201 });
}
