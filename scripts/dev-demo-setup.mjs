// DEV-ONLY demo setup (run after seed-hostel.mjs). NOT a product seed.
//  1. Inserts a few OPEN agent_blockers (with pathways + confirm_action) so the
//     /org steward veto-queue renders with working Dismiss/pathway/confirm rows.
//  2. Creates a "member" login linked to a seeded member row so / (the per-user
//     permission-lens board) is viewable.
// Idempotent: clears its own demo rows (blocked_work_ref like 'demo-veto%') first.
//
//   docker exec acropolisos-app node /app/scripts/dev-demo-setup.mjs
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const postgres = require("postgres");
const bcrypt = require("bcryptjs");

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = postgres(DB_URL);
const USERS_FILE = "/app/data/users.json";
const DEV_PW = "acropolis-dev";

const members = await sql`select id, full_name, email, tier_role from member order by full_name`;
if (members.length === 0) { console.error("no members — run seed-hostel.mjs first"); await sql.end(); process.exit(1); }
const actor = members[0];

// ── 1. open agent_blockers (the decision board) ─────────────────────────────
await sql`delete from agent_blocker where blocked_work_ref like 'demo-veto%'`;
const blockers = [
  {
    reason_kind: "approval",
    summary: "Approve 4-week work-trade extension for a long-stay volunteer",
    detail: "Volunteer requests extending their work-trade beyond the 2-week cap.",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: randomUUID(), label: "Approve extension", rationale: "Strong track record", action: { type: "extend_work_trade" }, reversibility: "moderate" },
      { id: randomUUID(), label: "Decline — keep the 2-week cap", rationale: "Policy", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    confirm_action: null,
  },
  {
    reason_kind: "confirmation",
    summary: "Confirm early 08:00 check-in for a group of 4",
    detail: "Standard check-in is 15:00; the room is already clean.",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: randomUUID(), label: "Allow early check-in", rationale: "Room ready", action: { type: "confirm_and_proceed" }, reversibility: "easy" },
    ]),
    confirm_action: JSON.stringify({ label: "Allow early check-in", action: { type: "confirm_and_proceed", params: {} } }),
  },
  {
    reason_kind: "missing_data",
    summary: "Emergency contact missing for an under-18 guest",
    detail: "House policy requires an emergency contact before check-in.",
    resolution_mode: "pathways",
    pathways: JSON.stringify([
      { id: randomUUID(), label: "Email the guest for a contact", action: { type: "send_notification" }, reversibility: "easy" },
      { id: randomUUID(), label: "Hold check-in until provided", action: { type: "defer_decision" }, reversibility: "easy" },
    ]),
    confirm_action: null,
  },
];
let n = 0;
for (const b of blockers) {
  n += 1;
  await sql`insert into agent_blocker ${sql({
    id: randomUUID(),
    blocked_actor_id: actor.id,
    reason_kind: b.reason_kind,
    summary: b.summary,
    detail: b.detail,
    blocked_work_ref: `demo-veto/${n}`,
    resolution_mode: b.resolution_mode,
    pathways: b.pathways,
    confirm_action: b.confirm_action,
    status: "open",
    created_at: new Date(),
  })}`;
}
console.log(`open agent_blockers inserted: ${n} (actor ${actor.full_name})`);

// ── 2. member login linked to a real member row ─────────────────────────────
const data = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
const email = (actor.email && /@/.test(actor.email)) ? actor.email.toLowerCase()
  : `${actor.full_name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@acropolisos.local`;
const existing = data.users.find((u) => u.id === actor.id);
if (existing) {
  existing.passwordHash = bcrypt.hashSync(DEV_PW, 10);
  existing.email = email;
  existing.role = "member";
} else {
  data.users.push({
    id: actor.id, email, passwordHash: bcrypt.hashSync(DEV_PW, 10),
    role: "member", customRoles: [], createdAt: new Date().toISOString(),
  });
}
fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
console.log(`member login: ${email} / ${DEV_PW}  (role=member, tier_role=${actor.tier_role}, member.id=${actor.id})`);

await sql.end();
console.log("done");
