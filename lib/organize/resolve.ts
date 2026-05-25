// A4: Near-match dedup — resolve.ts
//
// findDuplicates: given a target type and a set of mapped fields from a proposal,
// query existing rows of that type and return near-match candidates scored by
// field similarity.
//
// Matching rules (per candidate):
//   - email exact-match (normalized):       score 1.0
//   - key-field normalized-exact match:     score 0.95
//   - key-field Levenshtein distance <= 2:  score 0.8
//
// No external deps — Levenshtein is a small inline implementation.
// Normalization: lowercase + trim + strip diacritics (NFD decompose + drop Mn category).
// Returns up to 5 candidates sorted by score desc.
//
// KEY_FIELDS defines the human-identity fields to match on per type.
// Only same-type dedup — cross-type FK resolution is deferred (A5+).

import { sql } from "drizzle-orm";
import type { Database } from "../db/client";

// ── Target type ───────────────────────────────────────────────────────────────

export type TargetType =
  | "guest"
  | "member"
  | "booking"
  | "event"
  | "bed"
  | "room"
  | "shift"
  | "work_trade_agreement";

// ── Key fields per type ────────────────────────────────────────────────────────
// These are the human-identity fields used for near-match scoring.
// email is treated specially (exact-match → 1.0); all others use name-like matching.

export const KEY_FIELDS: Record<TargetType, string[]> = {
  guest:                ["email", "full_name"],
  member:               ["email", "full_name"],
  event:                ["title"],
  booking:              ["label"],
  bed:                  ["code"],
  room:                 ["code"],
  shift:                ["label"],
  work_trade_agreement: ["label"],
};

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// ── Levenshtein distance (inline — no new dep) ────────────────────────────────

export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // fast exits
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;

  // Two-row DP (space-efficient)
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ── Candidate result ──────────────────────────────────────────────────────────

export interface DuplicateCandidate {
  id: string;
  label: string;
  score: number;
}

// ── findDuplicates ─────────────────────────────────────────────────────────────
// Query existing rows of `targetType` for near-matches on the key fields
// present in `mappedFields`. Returns up to 5 candidates, score desc.

const TABLE_NAMES: Record<TargetType, string> = {
  guest:                "guest",
  member:               "member",
  booking:              "booking",
  event:                "event",
  bed:                  "bed",
  room:                 "room",
  shift:                "shift",
  work_trade_agreement: "work_trade_agreement",
};

// What column to use as the human-readable label for display in the UI.
const LABEL_FIELD: Record<TargetType, string> = {
  guest:                "full_name",
  member:               "full_name",
  event:                "title",
  booking:              "label",
  bed:                  "code",
  room:                 "code",
  shift:                "label",
  work_trade_agreement: "label",
};

export async function findDuplicates(
  db: Database,
  targetType: TargetType,
  mappedFields: Record<string, unknown>,
): Promise<DuplicateCandidate[]> {
  const keyFields = KEY_FIELDS[targetType];
  const tableName = TABLE_NAMES[targetType];
  const labelField = LABEL_FIELD[targetType];

  // Collect key fields that are actually present in mappedFields.
  const presentKeyFields = keyFields.filter(
    (f) => mappedFields[f] !== undefined && mappedFields[f] !== null && mappedFields[f] !== "",
  );

  if (presentKeyFields.length === 0) {
    // No key fields present → nothing to match on, skip dedup.
    return [];
  }

  // Pull all existing rows (id + all key fields + label field).
  // We fetch raw and score in-process — tables are small (hostel use-case).
  const selectCols = Array.from(new Set([
    "id",
    labelField,
    ...keyFields,
  ]));
  const colList = selectCols.map((c) => `"${c}"`).join(", ");

  const rows = await db.execute(
    sql.raw(`SELECT ${colList} FROM "${tableName}" LIMIT 2000`),
  ) as unknown as Array<Record<string, unknown>>;

  // rows may come back as { rows: [...] } (drizzle postgres.js shape) or as the array itself
  const rowsArray: Array<Record<string, unknown>> = Array.isArray(rows)
    ? rows
    : ((rows as { rows?: Array<Record<string, unknown>> }).rows ?? []);

  const scored: DuplicateCandidate[] = [];

  for (const row of rowsArray) {
    let bestScore = 0;

    for (const field of presentKeyFields) {
      const incoming = String(mappedFields[field] ?? "");
      const existing = String(row[field] ?? "");
      if (!incoming || !existing) continue;

      const normIncoming = normalizeStr(incoming);
      const normExisting = normalizeStr(existing);

      let fieldScore = 0;

      if (field === "email") {
        // Email: normalized exact match only → 1.0
        if (normIncoming === normExisting) {
          fieldScore = 1.0;
        }
      } else {
        // Name-like fields
        if (normIncoming === normExisting) {
          fieldScore = 0.95;
        } else {
          const dist = levenshtein(normIncoming, normExisting);
          if (dist <= 2) {
            fieldScore = 0.8;
          }
        }
      }

      if (fieldScore > bestScore) {
        bestScore = fieldScore;
      }
    }

    if (bestScore > 0) {
      const id = String(row["id"]);
      const labelValue = String(row[labelField] ?? id);
      scored.push({ id, label: labelValue, score: bestScore });
    }
  }

  // Sort by score desc, cap at 5
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}
