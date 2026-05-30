// DEV-ONLY: seed the book-club second instance (bookclub DB) + bypass setup wizard.
//   docker exec acropolisos-bc node /app/scripts/bc-demo-setup.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const postgres = require("postgres");
const bcrypt = require("bcryptjs");
const sql = postgres(process.env.DATABASE_URL);
const DATA = "/app/data";
fs.mkdirSync(DATA, { recursive: true });

fs.writeFileSync(`${DATA}/setup.json`, JSON.stringify(
  { completed: true, completedAt: new Date().toISOString(), stewardEmail: "steward@bookclub.local" }, null, 2));
fs.writeFileSync(`${DATA}/users.json`, JSON.stringify({ users: [{
  id: randomUUID(), email: "steward@bookclub.local",
  passwordHash: bcrypt.hashSync("acropolis-dev", 10),
  role: "steward", customRoles: [], createdAt: new Date().toISOString(),
}] }, null, 2));

await sql`delete from agent_blocker`;
await sql`delete from book`;
await sql`delete from reading_meeting`;
await sql`delete from member`;

const members = [
  { id: randomUUID(), full_name: "Maya Okonkwo", email: "maya@bookclub.local", phone: "+1-202-555-0111", tier_role: "manager", started_at: "2025-01-15" },
  { id: randomUUID(), full_name: "Liam Schwartz", email: "liam@bookclub.local", phone: "+1-202-555-0112", tier_role: "staff", started_at: "2025-03-02" },
  { id: randomUUID(), full_name: "Priya Nair", email: "priya@bookclub.local", phone: "+1-202-555-0113", tier_role: "staff", started_at: "2025-06-20" },
];
for (const m of members) { try { await sql`insert into member ${sql(m)} on conflict do nothing`; } catch (e) { console.error("member:", e.message); } }

const books = [
  { id: randomUUID(), title: "The Left Hand of Darkness", author: "Ursula K. Le Guin", year: 1969 },
  { id: randomUUID(), title: "Braiding Sweetgrass", author: "Robin Wall Kimmerer", year: 2013 },
  { id: randomUUID(), title: "The Dispossessed", author: "Ursula K. Le Guin", year: 1974 },
  { id: randomUUID(), title: "Pachinko", author: "Min Jin Lee", year: 2017 },
];
for (const b of books) { try { await sql`insert into book ${sql(b)} on conflict do nothing`; } catch (e) { console.error("book:", e.message); } }

const meetings = [
  { id: randomUUID(), label: "March: The Left Hand of Darkness", date: "2026-03-12" },
  { id: randomUUID(), label: "April: Braiding Sweetgrass", date: "2026-04-09" },
  { id: randomUUID(), label: "May: The Dispossessed", date: "2026-05-14" },
];
for (const m of meetings) { try { await sql`insert into reading_meeting ${sql(m)} on conflict do nothing`; } catch (e) { console.error("meeting:", e.message); } }

try {
  await sql`insert into agent_blocker ${sql({
    id: randomUUID(), blocked_actor_id: members[0].id, reason_kind: "approval",
    summary: "Approve a budget increase for next quarter's hardcovers",
    detail: "Members requested 3 hardcovers beyond the standard book budget.",
    blocked_work_ref: "demo-bc/1", resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: randomUUID(), label: "Approve the increase", action: { type: "approve_budget" }, reversibility: "moderate" },
      { id: randomUUID(), label: "Keep the standard budget", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    confirm_action: null, status: "open", created_at: new Date(),
  })}`;
} catch (e) { console.error("blocker:", e.message); }

const c = await sql`select
  (select count(*) from book) books, (select count(*) from reading_meeting) meetings,
  (select count(*) from member) members, (select count(*) from agent_blocker where status='open') open_blockers`;
console.log("seeded:", JSON.stringify(c[0]));
await sql.end();
