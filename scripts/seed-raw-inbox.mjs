// F4: Seed raw_inbox with 6 messy guest/booking rows.
// Demonstrates shape variance + 1 intentional duplicate (Marta López / Marta Lopez).
//
// Run inside the app container:
//   docker exec acropolisos-app node /app/scripts/seed-raw-inbox.mjs

import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const sql = postgres(DB_URL);

const rows = [
  {
    source: "manual",
    payload: {
      name: "Marta López",
      checkin: "2026-06-12",
      nights: 3,
      room_pref: "private",
    },
  },
  {
    source: "sheets-import",
    payload: {
      first: "Tom",
      last: "Yu",
      email: "tom@example.com",
      arrival: "2026-06-15",
    },
  },
  {
    source: "webhook-booking",
    payload: {
      guest_name: "Marta Lopez",
      dates: "Jun 12 - Jun 15",
      phone: "+34 600 11 22",
    },
  },
  {
    source: "manual",
    payload: {
      name: "Hiroshi Tanaka",
      passport_country: "JP",
      stay_length_days: 7,
    },
  },
  {
    source: "sheets-import",
    payload: {
      first: "Aïsha",
      last: "Diallo",
      tier: "wt",
      skills: ["reception", "cleaning"],
    },
  },
  {
    source: "manual",
    payload: {
      name: "John",
      notes: "friend of Sofía, arriving soon",
    },
  },
];

try {
  let inserted = 0;
  for (const row of rows) {
    await sql`
      INSERT INTO raw_inbox (source, payload)
      VALUES (${row.source}, ${sql.json(row.payload)})
    `;
    inserted++;
  }
  console.log(`raw_inbox: inserted ${inserted} rows`);
} catch (err) {
  console.error("FAILED:", err);
  process.exit(1);
} finally {
  await sql.end();
}

console.log("done");
