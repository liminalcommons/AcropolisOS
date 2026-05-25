// A5: /api/connect/csv — server-side CSV ingest into raw_inbox.
//
// Accepts a raw CSV text body (Content-Type: text/plain or text/csv) OR
// a JSON body { csv: "<text>" }. Parses the header row as keys; each
// subsequent row becomes ONE raw_inbox row with source='csv-upload' and
// payload = { header: value, ... }.
//
// Auth-gated (steward or authenticated member) — mirrors /api/connect/upload.
// No external CSV dep — hand-rolled parser handles quoted fields including
// multiline quoted fields (HIGH #1 fix) and enforces row + chunk limits
// (HIGH #2 fix).
//
// Body: text/plain OR text/csv (raw CSV) OR application/json { csv: string }
// Response: { ok: true, count: number, ids: string[] } | { error: string }

import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── Ingest limits ─────────────────────────────────────────────────────────────
const MAX_ROWS = 5000;
const CHUNK_SIZE = 1000; // rows per INSERT — well under pg 65535-param ceiling
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MB belt-check

// ── Quote-aware state-machine CSV parser (HIGH #1 fix) ────────────────────────
//
// Iterates the WHOLE text char-by-char, tracking inQuote state across newlines.
// A newline INSIDE quotes is part of the field value (multiline quoted field).
// A newline OUTSIDE quotes terminates a record.
// Double-quote ("") inside a quoted field → literal quote character.
// At end-of-input, if still inQuote → unterminated_quoted_field error.
// Returns { rows } on success or { error: "unterminated_quoted_field" } on bad input.

type ParseResult =
  | { ok: true; headers: string[]; rows: Record<string, string>[] }
  | { ok: false; error: "unterminated_quoted_field" };

function parseCSV(text: string): ParseResult {
  const trimmed = text.replace(/^﻿/, ""); // strip BOM if present

  // State machine
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = "";
  let inQuote = false;

  const flush = () => {
    // Trim unquoted fields, preserve quoted field whitespace
    currentRecord.push(currentField);
    currentField = "";
  };

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];

    if (inQuote) {
      if (ch === '"') {
        if (next === '"') {
          // Escaped double-quote inside quoted field → literal "
          currentField += '"';
          i++; // consume second "
        } else {
          // Closing quote
          inQuote = false;
        }
      } else {
        // Any char (including \n) inside quotes is part of the field
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ",") {
        // Field delimiter
        currentRecord.push(currentField.trim());
        currentField = "";
      } else if (ch === "\r" && next === "\n") {
        // CRLF record terminator
        flush();
        records.push(currentRecord);
        currentRecord = [];
        i++; // consume \n
      } else if (ch === "\n") {
        // LF record terminator
        flush();
        records.push(currentRecord);
        currentRecord = [];
      } else {
        currentField += ch;
      }
    }
  }

  // End of input
  if (inQuote) {
    return { ok: false, error: "unterminated_quoted_field" };
  }

  // Flush last field / record (handles no trailing newline)
  if (currentField !== "" || currentRecord.length > 0) {
    flush();
    records.push(currentRecord);
  }

  // Filter fully-blank records (trailing newline produces one empty record)
  const meaningful = records.filter((r) => r.some((f) => f.trim() !== ""));

  if (meaningful.length < 1) {
    // Header-only or empty file: return zero data rows (not an error)
    return { ok: true, headers: [], rows: [] };
  }

  const headers = meaningful[0];
  const rows: Record<string, string>[] = [];

  for (const record of meaningful.slice(1)) {
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = record[i] ?? "";
    }
    rows.push(row);
  }

  return { ok: true, headers, rows };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  // Auth gate — any authenticated member may push data.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Belt: content-length guard (5 MB)
  const clHeader = req.headers.get("content-length");
  if (clHeader !== null) {
    const cl = parseInt(clHeader, 10);
    if (!isNaN(cl) && cl > MAX_BODY_BYTES) {
      return Response.json(
        { error: "body_too_large", max_bytes: MAX_BODY_BYTES, got: cl },
        { status: 413 },
      );
    }
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

  // Parse CSV — quote-aware state machine (HIGH #1)
  const parseResult = parseCSV(csvText);

  if (!parseResult.ok) {
    // Unterminated quoted field → 422 (no rows emitted)
    return Response.json({ error: parseResult.error }, { status: 422 });
  }

  const { rows } = parseResult;

  if (rows.length === 0) {
    // Header-only file or empty CSV is valid (count: 0)
    return Response.json({ ok: true, count: 0, ids: [] }, { status: 200 });
  }

  // Row cap (HIGH #2 — prevents pg param overflow + OOM)
  if (rows.length > MAX_ROWS) {
    return Response.json(
      { error: "too_many_rows", max: MAX_ROWS, got: rows.length },
      { status: 413 },
    );
  }

  // Chunked transactional insert (HIGH #2 — stays well under 65535 pg param bound)
  const db = getDb();
  const allIds: string[] = [];

  try {
    await db.transaction(async (tx) => {
      for (let offset = 0; offset < rows.length; offset += CHUNK_SIZE) {
        const chunk = rows.slice(offset, offset + CHUNK_SIZE);
        const inserted = await tx
          .insert(raw_inbox)
          .values(chunk.map((payload) => ({ source: "csv-upload", payload })))
          .returning({ id: raw_inbox.id });
        for (const r of inserted) allIds.push(r.id);
      }
    });
  } catch (err) {
    return Response.json(
      {
        error: "insert_failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  return Response.json({ ok: true, count: allIds.length, ids: allIds }, { status: 201 });
}
