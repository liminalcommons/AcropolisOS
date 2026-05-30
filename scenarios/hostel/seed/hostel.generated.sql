-- emit-bundle-sql for schema "seed_hostel"
-- generated 2026-05-19T00:36:36.895Z

BEGIN;

DROP SCHEMA IF EXISTS "seed_hostel" CASCADE;
CREATE SCHEMA IF NOT EXISTS "seed_hostel";

CREATE TABLE "seed_hostel"."bed" (
  "id" text,
  "code" text NOT NULL,
  "room" text NOT NULL,
  "is_bottom_bunk" boolean NOT NULL DEFAULT TRUE,
  "out_of_service" boolean NOT NULL DEFAULT FALSE,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."booking" (
  "id" text,
  "label" text NOT NULL,
  "guest" text NOT NULL,
  "bed" text NOT NULL,
  "from_date" date NOT NULL,
  "to_date" date NOT NULL,
  "rate_per_night" numeric NOT NULL,
  "currency" text NOT NULL DEFAULT 'EUR',
  "source" text NOT NULL DEFAULT 'direct',
  "status" text NOT NULL DEFAULT 'confirmed',
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."event" (
  "id" text,
  "title" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "duration_hours" numeric NOT NULL DEFAULT 2,
  "attendance_cap" numeric,
  "organizer" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'scheduled',
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."guest" (
  "id" text,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "country" text NOT NULL,
  "phone" text NOT NULL,
  "arrived_at" date NOT NULL,
  "expected_departure" date NOT NULL,
  "current_status" text NOT NULL DEFAULT 'booked',
  "is_work_trader" boolean NOT NULL DEFAULT FALSE,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."incident_log" (
  "id" text,
  "summary" text NOT NULL,
  "body" text,
  "category" text NOT NULL,
  "severity" text NOT NULL DEFAULT 'low',
  "occurred_at" timestamptz NOT NULL,
  "reported_by" text NOT NULL,
  "resolved" boolean NOT NULL DEFAULT FALSE,
  "resolution_notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."member" (
  "id" text,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "phone" text NOT NULL,
  "tier_role" text NOT NULL DEFAULT 'staff',
  "started_at" date NOT NULL,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."room" (
  "id" text,
  "code" text NOT NULL,
  "kind" text NOT NULL,
  "capacity" numeric NOT NULL,
  "floor" numeric,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."shift" (
  "id" text,
  "label" text NOT NULL,
  "kind" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "duration_hours" numeric NOT NULL,
  "claimed_by" text,
  "status" text NOT NULL DEFAULT 'open',
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."work_trade_agreement" (
  "id" text,
  "label" text NOT NULL,
  "guest" text,
  "bed_comp" text NOT NULL,
  "hours_per_week" numeric NOT NULL DEFAULT 20,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_hostel"."guest_booked_into_bed" (
  "guest_id" text NOT NULL,
  "bed_id" text NOT NULL,
  "booking" text NOT NULL,
  PRIMARY KEY ("guest_id", "bed_id")
);

CREATE TABLE "seed_hostel"."member_staffed_shift" (
  "member_id" text NOT NULL,
  "shift_id" text NOT NULL,
  PRIMARY KEY ("member_id", "shift_id")
);

CREATE TABLE "seed_hostel"."guest_attended_event_event" (
  "guest_id" text NOT NULL,
  "event_id" text NOT NULL,
  PRIMARY KEY ("guest_id", "event_id")
);

CREATE TABLE "seed_hostel"."incident_log_involves_guest" (
  "incident_log_id" text NOT NULL,
  "guest_id" text NOT NULL,
  PRIMARY KEY ("incident_log_id", "guest_id")
);

CREATE TABLE "seed_hostel"."work_trade_agreement_trading_for_bed" (
  "work_trade_agreement_id" text NOT NULL,
  "bed_id" text NOT NULL,
  PRIMARY KEY ("work_trade_agreement_id", "bed_id")
);

INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-001', 'D1-A1', 'r-001', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-002', 'D1-A2', 'r-001', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-003', 'D1-B1', 'r-001', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-004', 'D1-B2', 'r-001', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-005', 'D1-C1', 'r-001', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-006', 'D1-C2', 'r-001', FALSE, TRUE, 'Frame cracked — awaiting replacement');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-007', 'D2-A1', 'r-002', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-008', 'D2-A2', 'r-002', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-009', 'D2-B1', 'r-002', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-010', 'D2-B2', 'r-002', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-011', 'D2-C1', 'r-002', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-012', 'D2-C2', 'r-002', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-013', 'D2-D1', 'r-002', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-014', 'D2-D2', 'r-002', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-015', 'D3-A1', 'r-003', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-016', 'D3-A2', 'r-003', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-017', 'D3-B1', 'r-003', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-018', 'D3-B2', 'r-003', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-019', 'D3-C1', 'r-003', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-020', 'D3-C2', 'r-003', FALSE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-021', 'P1-double', 'r-004', TRUE, FALSE, 'Double bed counts as one Bed row');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-022', 'P2-1', 'r-005', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-023', 'P2-2', 'r-005', TRUE, FALSE, '');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-024', 'S1-1', 'r-006', TRUE, FALSE, 'Pablo (lives on-site)');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-025', 'S1-2', 'r-006', FALSE, FALSE, 'Sara');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-026', 'S1-3', 'r-006', TRUE, FALSE, 'Work-trader slot A');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-027', 'S1-4', 'r-006', FALSE, FALSE, 'Work-trader slot B');
INSERT INTO "seed_hostel"."bed" ("id", "code", "room", "is_bottom_bunk", "out_of_service", "notes") VALUES ('b-028', 'D1-Cot', 'r-001', TRUE, TRUE, 'Spare cot, only deployed at >95% occupancy');

INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-001', 'Lena Petrov / D3-A2 / Jun 1-7', 'g-001', 'b-016', '2026-06-01', '2026-06-07', 22, 'EUR', 'direct', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-002', 'Hugo Sanderson / D2-A1 / Jun 1-3', 'g-002', 'b-007', '2026-06-01', '2026-06-03', 19, 'EUR', 'hostelworld', 'completed');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-003', 'Marta Esposito / P1 / Jun 2-9', 'g-003', 'b-021', '2026-06-02', '2026-06-09', 58, 'EUR', 'booking_com', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-004', 'Joon-ho Park / D2-B1 / Jun 2-5', 'g-004', 'b-009', '2026-06-02', '2026-06-05', 19, 'EUR', 'hostelworld', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-005', 'Fatima El-Amin / D3-B1 / Jun 3-8', 'g-005', 'b-017', '2026-06-03', '2026-06-08', 22, 'EUR', 'direct', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-006', 'Caleb Rosenthal / D1-A1 / Jun 3-6', 'g-006', 'b-001', '2026-06-03', '2026-06-06', 21, 'EUR', 'walk_in', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-007', 'Nia Adesanya / D3-C1 / Jun 4-7', 'g-007', 'b-019', '2026-06-04', '2026-06-07', 22, 'EUR', 'direct', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-008', 'Magnus Tellefsen / P2-1 / Jun 4-11', 'g-008', 'b-022', '2026-06-04', '2026-06-11', 35, 'EUR', 'booking_com', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-009', 'Beatriz Carvalho / D2-C1 / Jun 5-8', 'g-009', 'b-011', '2026-06-05', '2026-06-08', 19, 'EUR', 'hostelworld', 'confirmed');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-010', 'Daniyar Tursunov / D2-C2 / Jun 5-12', 'g-010', 'b-012', '2026-06-05', '2026-06-12', 19, 'EUR', 'booking_com', 'no_show');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-011', 'Sofía Mendieta / S1-3 / WORK-TRADE / May 20 - Jul 1', 'g-011', 'b-026', '2026-05-20', '2026-07-01', 0, 'EUR', 'work_trade', 'checked_in');
INSERT INTO "seed_hostel"."booking" ("id", "label", "guest", "bed", "from_date", "to_date", "rate_per_night", "currency", "source", "status") VALUES ('bk-012', 'Tomáš Novák / S1-4 / WORK-TRADE / May 15 - Jun 25', 'g-012', 'b-027', '2026-05-15', '2026-06-25', 0, 'EUR', 'work_trade', 'checked_in');

INSERT INTO "seed_hostel"."event" ("id", "title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status") VALUES ('ev-001', 'Welcome drink + house tour', '2026-06-01T19:00:00Z', 1, 30, 'hm-004', 'Daily welcome — meet other guests, learn the house rules', 'completed');
INSERT INTO "seed_hostel"."event" ("id", "title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status") VALUES ('ev-002', 'Old Town walking tour', '2026-06-03T10:30:00Z', 3, 12, 'hm-002', 'Free walking tour, tips welcome', 'completed');
INSERT INTO "seed_hostel"."event" ("id", "title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status") VALUES ('ev-003', 'Pasta night (family dinner)', '2026-06-04T20:00:00Z', 2, 16, 'hm-006', 'Tomáš cooking — 8 EUR contribution, bring drinks', 'scheduled');
INSERT INTO "seed_hostel"."event" ("id", "title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status") VALUES ('ev-004', 'Tapas night with Sofía', '2026-06-06T20:00:00Z', 3, 20, 'hm-005', 'Cooking takeover from work-trader; signups at reception', 'scheduled');
INSERT INTO "seed_hostel"."event" ("id", "title", "starts_at", "duration_hours", "attendance_cap", "organizer", "description", "status") VALUES ('ev-005', 'Sunday movie night', '2026-06-07T21:00:00Z', 2, 25, 'hm-003', 'Projector in common room, popcorn provided', 'scheduled');

INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-001', 'Lena Petrov', 'lena.petrov@example.org', 'DE', '+49170441122', '2026-06-01', '2026-06-07', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-002', 'Hugo Sanderson', 'hugo.s@example.org', 'AU', '+61404991122', '2026-06-01', '2026-06-03', 'checked_out', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-003', 'Marta Esposito', 'marta.e@example.org', 'IT', '+39348700100', '2026-06-02', '2026-06-09', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-004', 'Joon-ho Park', 'joonho@example.org', 'KR', '+821022334455', '2026-06-02', '2026-06-05', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-005', 'Fatima El-Amin', 'fatima.ea@example.org', 'MA', '+212661223344', '2026-06-03', '2026-06-08', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-006', 'Caleb Rosenthal', 'caleb.r@example.org', 'US', '+15103339911', '2026-06-03', '2026-06-06', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-007', 'Nia Adesanya', 'nia.a@example.org', 'NG', '+2348039988445', '2026-06-04', '2026-06-07', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-008', 'Magnus Tellefsen', 'magnus.t@example.org', 'NO', '+4798776655', '2026-06-04', '2026-06-11', 'checked_in', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-009', 'Beatriz Carvalho', 'bea.c@example.org', 'BR', '+5511988776655', '2026-06-05', '2026-06-08', 'booked', FALSE, '');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-010', 'Daniyar Tursunov', 'daniyar.t@example.org', 'KZ', '+77017223344', '2026-06-05', '2026-06-12', 'no_show', FALSE, 'Did not arrive by 22:00; flagged');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-011', 'Sofía Mendieta', 'sofia.m@example.org', 'AR', '+541125998877', '2026-05-20', '2026-07-01', 'checked_in', TRUE, 'Work-trader; second time at Solana');
INSERT INTO "seed_hostel"."guest" ("id", "full_name", "email", "country", "phone", "arrived_at", "expected_departure", "current_status", "is_work_trader", "notes") VALUES ('g-012', 'Tomáš Novák', 'tomas.n@example.org', 'CZ', '+420776112233', '2026-05-15', '2026-06-25', 'checked_in', TRUE, 'Work-trader; very reliable on kitchen shift');

INSERT INTO "seed_hostel"."incident_log" ("id", "summary", "body", "category", "severity", "occurred_at", "reported_by", "resolved", "resolution_notes") VALUES ('in-001', 'Noise complaint — D2 after 02:00', 'Guest in D3-A2 (Lena) reported loud music from D2 around 02:30. Pablo (night audit) went down, two D2 guests were watching a video without headphones. Asked to use headphones; complied immediately.', 'noise', 'low', '2026-06-02T00:30:00Z', 'hm-002', TRUE, 'Verbal reminder; logged for pattern-tracking only.');
INSERT INTO "seed_hostel"."incident_log" ("id", "summary", "body", "category", "severity", "occurred_at", "reported_by", "resolved", "resolution_notes") VALUES ('in-002', 'Lost key — D3-B1 (Fatima)', 'Key not returned at checkout. Replaced lock cylinder for the dorm as standard policy after lost key. Charged 15 EUR replacement fee.', 'lost_key', 'low', '2026-06-04T11:00:00Z', 'hm-002', TRUE, 'Fee charged; lock cylinder swapped.');
INSERT INTO "seed_hostel"."incident_log" ("id", "summary", "body", "category", "severity", "occurred_at", "reported_by", "resolved", "resolution_notes") VALUES ('in-003', 'D1-C2 frame cracked — bed out of service', 'Discovered during morning cleaning; appears to have failed at the join. Marked bed b-006 out_of_service. Need to order replacement frame or repair.', 'damage', 'medium', '2026-06-03T11:15:00Z', 'hm-003', FALSE, '');
INSERT INTO "seed_hostel"."incident_log" ("id", "summary", "body", "category", "severity", "occurred_at", "reported_by", "resolved", "resolution_notes") VALUES ('in-004', 'No-show: g-010 Daniyar Tursunov', 'Booked via Booking.com, expected check-in 17:00 Jun 5, did not arrive by 22:00 cutoff. Bed b-012 released for walk-ins.', 'other', 'info', '2026-06-05T22:05:00Z', 'hm-002', TRUE, 'Flagged as no-show on Booking.com extranet; first night charged per policy.');

INSERT INTO "seed_hostel"."member" ("id", "full_name", "email", "phone", "tier_role", "started_at", "notes") VALUES ('hm-001', 'Lucía Aranzubia', 'lucia@solana.es', '+34611112233', 'manager', '2022-04-01', 'Owner-operator');
INSERT INTO "seed_hostel"."member" ("id", "full_name", "email", "phone", "tier_role", "started_at", "notes") VALUES ('hm-002', 'Pablo Rey', 'pablo@solana.es', '+34611445566', 'supervisor', '2023-06-15', 'Lead reception, lives on-site');
INSERT INTO "seed_hostel"."member" ("id", "full_name", "email", "phone", "tier_role", "started_at", "notes") VALUES ('hm-003', 'Sara Mendoza', 'sara@solana.es', '+34622778899', 'staff', '2024-03-20', 'Cleaning lead');
INSERT INTO "seed_hostel"."member" ("id", "full_name", "email", "phone", "tier_role", "started_at", "notes") VALUES ('hm-004', 'Anna Vogt', 'anna.vogt@guest.local', '+49170555121', 'staff', '2026-04-15', 'Work-trader graduated to staff after 8 weeks');
INSERT INTO "seed_hostel"."member" ("id", "full_name", "email", "phone", "tier_role", "started_at", "notes") VALUES ('hm-005', 'Sofía Mendieta', 'sofia.m@example.org', '+541125998877', 'work_trader', '2026-05-20', 'Active work-trader; mirrors Guest g-011. Member row enables Shift.claimed_by to point at her.');
INSERT INTO "seed_hostel"."member" ("id", "full_name", "email", "phone", "tier_role", "started_at", "notes") VALUES ('hm-006', 'Tomáš Novák', 'tomas.n@example.org', '+420776112233', 'work_trader', '2026-05-15', 'Active work-trader; mirrors Guest g-012. Lead kitchen role.');

INSERT INTO "seed_hostel"."room" ("id", "code", "kind", "capacity", "floor", "notes") VALUES ('r-001', 'D1', 'dorm_mixed', 6, 1, 'Quietest dorm, away from street');
INSERT INTO "seed_hostel"."room" ("id", "code", "kind", "capacity", "floor", "notes") VALUES ('r-002', 'D2', 'dorm_mixed', 8, 1, 'Largest dorm; street-facing');
INSERT INTO "seed_hostel"."room" ("id", "code", "kind", "capacity", "floor", "notes") VALUES ('r-003', 'D3', 'dorm_female', 6, 2, '');
INSERT INTO "seed_hostel"."room" ("id", "code", "kind", "capacity", "floor", "notes") VALUES ('r-004', 'P1', 'private', 2, 2, 'Double bed; en-suite');
INSERT INTO "seed_hostel"."room" ("id", "code", "kind", "capacity", "floor", "notes") VALUES ('r-005', 'P2', 'private', 2, 2, 'Twin; shared bath');
INSERT INTO "seed_hostel"."room" ("id", "code", "kind", "capacity", "floor", "notes") VALUES ('r-006', 'S1', 'staff', 4, 3, 'Staff + work-trader sleeping room');

INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-001', 'Mon reception 08-14', 'reception', '2026-06-01T08:00:00Z', 6, 'hm-002', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-002', 'Mon reception 14-22', 'reception', '2026-06-01T14:00:00Z', 8, 'hm-004', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-003', 'Mon night audit 22-08', 'night_audit', '2026-06-01T22:00:00Z', 10, 'hm-002', 'done', 'Sleeps on call');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-004', 'Mon cleaning 10-14', 'cleaning', '2026-06-01T10:00:00Z', 4, 'hm-003', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-005', 'Mon breakfast 07-10', 'breakfast', '2026-06-01T07:00:00Z', 3, 'hm-006', 'done', 'Tomáš (work-trader)');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-006', 'Tue reception 08-14', 'reception', '2026-06-02T08:00:00Z', 6, 'hm-002', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-007', 'Tue reception 14-22', 'reception', '2026-06-02T14:00:00Z', 8, 'hm-005', 'done', 'Sofía (work-trader)');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-008', 'Tue cleaning 10-14', 'cleaning', '2026-06-02T10:00:00Z', 4, 'hm-003', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-009', 'Tue breakfast 07-10', 'breakfast', '2026-06-02T07:00:00Z', 3, 'hm-006', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-010', 'Wed reception 08-14', 'reception', '2026-06-03T08:00:00Z', 6, 'hm-004', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-011', 'Wed cleaning 10-14', 'cleaning', '2026-06-03T10:00:00Z', 4, 'hm-005', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-012', 'Wed laundry 14-17', 'laundry', '2026-06-03T14:00:00Z', 3, 'hm-005', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-013', 'Thu reception 08-14', 'reception', '2026-06-04T08:00:00Z', 6, 'hm-002', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-014', 'Thu cleaning 10-14', 'cleaning', '2026-06-04T10:00:00Z', 4, 'hm-003', 'in_progress', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-015', 'Thu breakfast 07-10', 'breakfast', '2026-06-04T07:00:00Z', 3, 'hm-006', 'done', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-016', 'Fri reception 08-14', 'reception', '2026-06-05T08:00:00Z', 6, 'hm-004', 'claimed', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-017', 'Fri reception 14-22', 'reception', '2026-06-05T14:00:00Z', 8, NULL, 'open', 'Anna offsite — needs cover');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-018', 'Fri night audit 22-08', 'night_audit', '2026-06-05T22:00:00Z', 10, 'hm-002', 'claimed', '');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-019', 'Sat tapas night (host)', 'social', '2026-06-06T20:00:00Z', 3, 'hm-005', 'claimed', 'Sofía hosting — kitchen takeover');
INSERT INTO "seed_hostel"."shift" ("id", "label", "kind", "starts_at", "duration_hours", "claimed_by", "status", "notes") VALUES ('sh-020', 'Sat cleaning 10-14', 'cleaning', '2026-06-06T10:00:00Z', 4, NULL, 'open', 'High-turnover Saturday — needs 2 people');

INSERT INTO "seed_hostel"."work_trade_agreement" ("id", "label", "guest", "bed_comp", "hours_per_week", "start_date", "end_date", "status", "notes") VALUES ('wta-001', 'Sofía Mendieta — work-trade May/Jun 2026', 'g-011', 'b-026', 20, '2026-05-20', '2026-07-01', 'active', 'Returning work-trader; previously here Sep-Nov 2025');
INSERT INTO "seed_hostel"."work_trade_agreement" ("id", "label", "guest", "bed_comp", "hours_per_week", "start_date", "end_date", "status", "notes") VALUES ('wta-002', 'Tomáš Novák — work-trade May/Jun 2026', 'g-012', 'b-027', 25, '2026-05-15', '2026-06-25', 'active', 'Lead kitchen role; reliable; might extend');
INSERT INTO "seed_hostel"."work_trade_agreement" ("id", "label", "guest", "bed_comp", "hours_per_week", "start_date", "end_date", "status", "notes") VALUES ('wta-003', 'Anna Vogt — work-trade Apr-Jun 2026 (graduated to staff)', NULL, 'b-026', 20, '2026-02-15', '2026-04-15', 'completed', 'Hired as paid staff after agreement completed — see hm-004');

INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-001', 'ev-001');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-002', 'ev-001');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-001', 'ev-002');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-003', 'ev-002');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-004', 'ev-002');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-005', 'ev-002');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-006', 'ev-002');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-001', 'ev-003');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-003', 'ev-003');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-005', 'ev-003');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-007', 'ev-003');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-008', 'ev-003');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-001', 'ev-004');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-003', 'ev-004');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-005', 'ev-004');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-008', 'ev-004');
INSERT INTO "seed_hostel"."guest_attended_event_event" ("guest_id", "event_id") VALUES ('g-009', 'ev-004');

COMMIT;
