// One-shot loader for the hostel seed bundle.
// Reads packages/acropolisos/scenarios/hostel/seed/*.json, maps string ids → uuids
// consistently across files, and inserts into the matching tables.
//
// Run inside the app container:
//   docker exec acropolisos-app node /app/scripts/seed-hostel.mjs

import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const DATA_DIR = "/app/scenarios/hostel/seed";

const sql = postgres(DB_URL);

// Build a stable string-id → uuid map across all files. Any field value that
// matches /^[a-z]+-\d+$/ gets a UUID assigned the first time we see it.
const idMap = new Map();
function uuidFor(strId) {
  if (typeof strId !== "string") return strId;
  if (!/^[a-z]+-\d+$/.test(strId)) return strId;
  if (!idMap.has(strId)) idMap.set(strId, randomUUID());
  return idMap.get(strId);
}

function loadJson(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// Walk every value in every row of every file once to populate idMap
// (so booking.guest references seen in booking.json get the same uuid as
// the guest's own id in guest.json, regardless of file load order).
function preMapIds(rows) {
  for (const row of rows) {
    for (const v of Object.values(row)) {
      uuidFor(v);
    }
  }
}

// Transform every value in a row through uuidFor.
function remapRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = uuidFor(v);
  }
  return out;
}

async function insertRows(table, rows, columns) {
  if (!rows || rows.length === 0) return 0;
  let inserted = 0;
  for (const raw of rows) {
    const row = remapRow(raw);
    const cols = columns ?? Object.keys(row);
    const values = cols.map((c) => row[c]);
    try {
      await sql`INSERT INTO ${sql(table)} ${sql(row, ...cols)} ON CONFLICT DO NOTHING`;
      inserted++;
    } catch (err) {
      console.error(`  ! ${table}: ${err.message}`);
    }
  }
  return inserted;
}

// ── Phase 1: pre-map all ids across all files ─────────────────────
const files = {
  guest: loadJson("guest.json"),
  member: loadJson("member.json"),
  room: loadJson("room.json"),
  bed: loadJson("bed.json"),
  booking: loadJson("booking.json"),
  shift: loadJson("shift.json"),
  workTrade: loadJson("work-trade-agreement.json"),
  event: loadJson("event.json"),
  incident: loadJson("incident-log.json"),
  attended: loadJson("attended_event.json"),
};
for (const rows of Object.values(files)) {
  if (rows) preMapIds(rows);
}
console.log(`mapped ${idMap.size} string ids → uuids`);

// ── Phase 2: insert in FK-safe order ──────────────────────────────
try {
  // Independent objects first
  console.log("guest:", await insertRows("guest", files.guest));
  console.log("member:", await insertRows("member", files.member));
  console.log("room:", await insertRows("room", files.room));
  console.log("event:", await insertRows("event", files.event));

  // Depend on room/guest
  console.log("bed:", await insertRows("bed", files.bed));

  // Depend on guest + bed
  console.log("booking:", await insertRows("booking", files.booking));

  // Depend on member|guest
  console.log("shift:", await insertRows("shift", files.shift));

  // Depend on guest + bed
  console.log(
    "work_trade_agreement:",
    await insertRows("work_trade_agreement", files.workTrade),
  );

  // Depend on guest
  console.log("incident_log:", await insertRows("incident_log", files.incident));

  // Link table — guest_attended_event_event
  if (files.attended) {
    // attended.json shape may be like [{guest:"g-001", event:"e-001", attended_at: "..."}]
    // Map to the link table columns. Try common name variants.
    const linkRows = files.attended.map((r) => {
      const out = {};
      const gid = r.guest_id ?? r.guest ?? r.from ?? r.from_id;
      const eid = r.event_id ?? r.event ?? r.to ?? r.to_id;
      if (gid) out.guest_id = uuidFor(gid);
      if (eid) out.event_id = uuidFor(eid);
      for (const [k, v] of Object.entries(r)) {
        if (!["guest_id", "guest", "from", "from_id", "event_id", "event", "to", "to_id"].includes(k)) {
          out[k] = uuidFor(v);
        }
      }
      return out;
    });
    console.log(
      "guest_attended_event_event:",
      await insertRows("guest_attended_event_event", linkRows),
    );
  }
} catch (err) {
  console.error("FAILED:", err);
  process.exit(1);
} finally {
  await sql.end();
}

console.log("done");
