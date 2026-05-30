-- emit-bundle-sql for schema "seed_permaculture_org"
-- generated 2026-05-19T00:36:18.246Z

BEGIN;

DROP SCHEMA IF EXISTS "seed_permaculture_org" CASCADE;
CREATE SCHEMA IF NOT EXISTS "seed_permaculture_org";

CREATE TABLE "seed_permaculture_org"."harvest" (
  "id" text,
  "label" text NOT NULL,
  "planting" text NOT NULL,
  "quantity" numeric NOT NULL,
  "unit" text NOT NULL DEFAULT 'kg',
  "harvested_at" date NOT NULL,
  "harvested_by" text NOT NULL,
  "destination" text NOT NULL DEFAULT 'shared',
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."member" (
  "id" text,
  "full_name" text NOT NULL,
  "email" text NOT NULL,
  "joined_at" date NOT NULL,
  "pronouns" text NOT NULL,
  "tier_role" text NOT NULL DEFAULT 'volunteer',
  "skills" text NOT NULL,
  "availability" text NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."observation" (
  "id" text,
  "summary" text NOT NULL,
  "body" text,
  "category" text NOT NULL DEFAULT 'other',
  "site" text,
  "planting" text,
  "observed_at" timestamptz NOT NULL,
  "author" text NOT NULL,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."planting" (
  "id" text,
  "label" text NOT NULL,
  "species" text NOT NULL,
  "variety" text,
  "site" text NOT NULL,
  "planted_at" date NOT NULL,
  "expected_harvest" date,
  "status" text NOT NULL DEFAULT 'planted',
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."site" (
  "id" text,
  "name" text NOT NULL,
  "zone" text NOT NULL,
  "area_m2" numeric,
  "parent_site" text,
  "soil_type" text,
  "notes" text,
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."task" (
  "id" text,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "estimated_hours" numeric NOT NULL DEFAULT 1,
  "work_party" text,
  "site" text,
  "claimed_by" text,
  "status" text NOT NULL DEFAULT 'open',
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."work_party" (
  "id" text,
  "title" text NOT NULL,
  "starts_at" timestamptz NOT NULL,
  "duration_hours" numeric NOT NULL DEFAULT 3,
  "site" text NOT NULL,
  "coordinator" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'scheduled',
  PRIMARY KEY ("id")
);

CREATE TABLE "seed_permaculture_org"."member_attended_work_party" (
  "member_id" text NOT NULL,
  "work_party_id" text NOT NULL,
  "hours_contributed" numeric NOT NULL,
  "role" text NOT NULL DEFAULT 'participant',
  PRIMARY KEY ("member_id", "work_party_id")
);

CREATE TABLE "seed_permaculture_org"."member_assigned_to_task" (
  "member_id" text NOT NULL,
  "task_id" text NOT NULL,
  PRIMARY KEY ("member_id", "task_id")
);

CREATE TABLE "seed_permaculture_org"."planting_located_at_site" (
  "planting_id" text NOT NULL,
  "site_id" text NOT NULL,
  PRIMARY KEY ("planting_id", "site_id")
);

CREATE TABLE "seed_permaculture_org"."planting_yielded_harvest" (
  "planting_id" text NOT NULL,
  "harvest_id" text NOT NULL,
  PRIMARY KEY ("planting_id", "harvest_id")
);

CREATE TABLE "seed_permaculture_org"."member_observed_observation" (
  "member_id" text NOT NULL,
  "observation_id" text NOT NULL,
  PRIMARY KEY ("member_id", "observation_id")
);

CREATE TABLE "seed_permaculture_org"."site_subsite_of_site" (
  "from_site_id" text NOT NULL,
  "to_site_id" text NOT NULL,
  PRIMARY KEY ("from_site_id", "to_site_id")
);

INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-001', 'Radish first pull', 'p-011', 1.8, 'kg', '2026-04-22', 'm-007', 'shared');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-002', 'Radish second pull', 'p-011', 2.1, 'kg', '2026-04-26', 'm-005', 'shared');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-003', 'Kale spring cut #1', 'p-003', 3.4, 'kg', '2026-04-30', 'm-003', 'distributed');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-004', 'Kale spring cut #2', 'p-003', 2.9, 'kg', '2026-05-08', 'm-004', 'distributed');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-005', 'Kale spring cut #3', 'p-003', 2.2, 'kg', '2026-05-16', 'm-007', 'shared');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-006', 'Kale final + bolt', 'p-003', 1.6, 'kg', '2026-05-20', 'm-003', 'preserved');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-007', 'Garlic scapes (early curl)', 'p-005', 0.9, 'kg', '2026-05-15', 'm-003', 'shared');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-008', 'Basil first pinch', 'p-012', 0.3, 'kg', '2026-05-18', 'm-010', 'shared');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-009', 'Comfrey leaf cut (mulch prep)', 'p-008', 4.5, 'kg', '2026-05-09', 'm-001', 'compost');
INSERT INTO "seed_permaculture_org"."harvest" ("id", "label", "planting", "quantity", "unit", "harvested_at", "harvested_by", "destination") VALUES ('h-010', 'Comfrey leaf cut #2', 'p-008', 5.1, 'kg', '2026-05-17', 'm-002', 'compost');

INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-001', 'Mira Okafor', 'mira@riverside.coop', '2024-03-10', 'she/her', 'coordinator', 'facilitation, soil, beekeeping', 'weekends + Wed afternoons');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-002', 'Theo Lindgren', 'theo@riverside.coop', '2024-05-22', 'he/him', 'steward', 'carpentry, irrigation, mulching', 'Mon/Tue/Sat');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-003', 'Anaïs Bellafonte', 'anais@riverside.coop', '2025-01-14', 'she/they', 'steward', 'seed saving, pruning, herbal medicine', 'Wed-Fri');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-004', 'Kwame Nartey', 'kwame@riverside.coop', '2025-04-02', 'he/him', 'volunteer', 'composting, foraging', 'weekends');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-005', 'Saoirse Doolan', 'saoirse@riverside.coop', '2025-07-19', 'she/her', 'volunteer', 'documentation, food prep', 'Sat mornings');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-006', 'Yuki Tanahashi', 'yuki@riverside.coop', '2025-09-11', 'they/them', 'volunteer', 'permaculture design, water systems', 'Tues + Thurs');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-007', 'Marcus Whitfield', 'marcus@riverside.coop', '2025-11-03', 'he/him', 'volunteer', 'weeding, harvesting', 'weekends');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-008', 'Priya Ramachandran', 'priya@riverside.coop', '2026-02-08', 'she/her', 'volunteer', 'outreach, social media, mycology', 'remote + occasional Sat');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-009', 'Owen Akerley', 'owen@riverside.coop', '2026-03-12', 'he/him', 'volunteer', 'fencing, heavy lifting', 'Sundays');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-010', 'Esperanza Vidal', 'esperanza@riverside.coop', '2026-03-30', 'she/her', 'volunteer', 'seedlings, greenhouse', 'Tues-Thurs mornings');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-011', 'Joel Park', 'joel@riverside.coop', '2026-04-15', 'he/him', 'visitor', 'photography', 'drop-in');
INSERT INTO "seed_permaculture_org"."member" ("id", "full_name", "email", "joined_at", "pronouns", "tier_role", "skills", "availability") VALUES ('m-012', 'Aïsha Benabdellah', 'aisha@riverside.coop', '2026-04-22', 'she/her', 'visitor', '', 'Sat afternoons');

INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-001', 'Slugs heavy on brassicas after Tues rain', 'Counted ~18 slugs on Bed A2 in a 10min sweep this morning. Tried beer trap last year, modest results. Considering hand-picking rota at dusk.', 'pest', 's-004', 'p-004', '2026-05-04T07:20:00Z', 'm-003');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-002', 'Compost bay-2 wall finally gave out', 'South pallet fully rotted through. Needs full replacement, not patch. Marcus has spare pallets in his shed.', 'other', 's-010', NULL, '2026-05-06T16:00:00Z', 'm-002');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-003', 'Apple guild — early aphid pressure on one tree', 'NE Liberty tree has clusters on tip growth. Ladybug larvae already present so leaving alone. Will check in 5 days.', 'pest', 's-006', 'p-007', '2026-05-10T11:00:00Z', 'm-001');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-004', 'Cistern down to ~30% after dry week', 'Forecast says rain Thursday. If no rain by Sat we should ration drip lines.', 'weather', 's-001', NULL, '2026-05-11T18:15:00Z', 'm-006');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-005', 'Frog spotted near pond — first this year', 'Small green frog, possibly Pacific tree frog. Good sign for pond ecology.', 'wildlife', 's-009', NULL, '2026-05-12T19:40:00Z', 'm-004');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-006', 'Garlic scapes curling — time to cut', 'All Music scapes fully curled. Cut today before they straighten, redirects energy to bulbs.', 'growth', 's-005', 'p-005', '2026-05-15T08:30:00Z', 'm-003');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-007', 'Tomato seedlings showing slight purpling on stems', 'Possible phosphorus availability issue from cool soil. Side-dressed with worm castings.', 'growth', 's-003', 'p-001', '2026-05-03T10:15:00Z', 'm-001');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-008', 'Pollinator strip — bumblebees on early phacelia', 'Counted at least 6 bumblebees foraging at noon. Wildflower mix #3 is paying off.', 'wildlife', 's-008', 'p-010', '2026-05-14T12:30:00Z', 'm-006');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-009', 'Greenhouse temperature spike — 38°C', 'Forgot to open vents Saturday. Cucumber starts wilted but recovered overnight. Need a thermostat-driven vent.', 'weather', 's-007', 'p-009', '2026-05-05T15:00:00Z', 'm-010');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-010', 'Powdery mildew starting on cucumber leaves', 'Two lower leaves on greenhouse cucumbers. Pruned and binned (not composted).', 'disease', 's-007', 'p-009', '2026-05-17T09:00:00Z', 'm-003');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-011', 'Soil test result — pH 6.4 in Bed A2', 'Dropped from 6.8 last autumn. Lime amendment next autumn.', 'soil', 's-004', NULL, '2026-05-02T14:00:00Z', 'm-001');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-012', 'Flea beetles on cabbage seedlings', 'Light damage. Row cover going on tomorrow.', 'pest', 's-004', 'p-004', '2026-05-13T07:00:00Z', 'm-007');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-013', 'Comfrey ready for second cut', 'Fast regrowth from May-09 cut. Cutting tomorrow for mulch around tomatoes.', 'growth', 's-006', 'p-008', '2026-05-16T11:00:00Z', 'm-002');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-014', 'Visitor asked about chickens — recurring question', 'Third visitor this month asked if we keep poultry. Worth a brainstorm whether to extend the ontology / scope of the site.', 'other', 's-001', NULL, '2026-05-11T15:00:00Z', 'm-008');
INSERT INTO "seed_permaculture_org"."observation" ("id", "summary", "body", "category", "site", "planting", "observed_at", "author") VALUES ('o-015', 'Mason bee hotel — high occupancy', 'All 40 tubes filled. Should expand for next spring.', 'wildlife', 's-006', NULL, '2026-05-08T13:00:00Z', 'm-001');

INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-001', 'Bed A1 Tomatoes 2026', 'Solanum lycopersicum', 'Brandywine + San Marzano', 's-003', '2026-04-28', '2026-07-25', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-002', 'Bed A1 Peppers 2026', 'Capsicum annuum', 'Jimmy Nardello', 's-003', '2026-05-02', '2026-08-10', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-003', 'Bed A2 Kale 2026', 'Brassica oleracea', 'Lacinato', 's-004', '2026-03-15', '2026-05-20', 'harvested');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-004', 'Bed A2 Cabbage 2026', 'Brassica oleracea', 'Caraflex', 's-004', '2026-04-10', '2026-07-15', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-005', 'Bed A3 Garlic 2025-26', 'Allium sativum', 'Music', 's-005', '2025-10-25', '2026-07-05', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-006', 'Bed A3 Onions 2026', 'Allium cepa', 'Stuttgarter', 's-005', '2026-04-05', '2026-08-20', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-007', 'Food Forest Apple Guild', 'Malus domestica', 'Liberty + Honeycrisp', 's-006', '2024-03-22', '2026-09-10', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-008', 'Food Forest Comfrey understory', 'Symphytum officinale', 'Bocking 14', 's-006', '2024-04-12', NULL, 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-009', 'Greenhouse Cucumber starts 2026', 'Cucumis sativus', 'Marketmore', 's-007', '2026-03-18', '2026-06-25', 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-010', 'Pollinator strip 2026 reseed', 'mixed natives', 'wildflower mix #3', 's-008', '2026-04-02', NULL, 'growing');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-011', 'Bed A2 Radish (companion)', 'Raphanus sativus', 'French Breakfast', 's-004', '2026-03-20', '2026-04-25', 'harvested');
INSERT INTO "seed_permaculture_org"."planting" ("id", "label", "species", "variety", "site", "planted_at", "expected_harvest", "status") VALUES ('p-012', 'Bed A1 Basil interplant', 'Ocimum basilicum', 'Genovese', 's-003', '2026-05-12', '2026-07-30', 'growing');

INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-001', 'Riverside Garden (whole site)', '3', 4200, NULL, 'loam, clay-heavy near river', '0.42 ha along the river. Co-managed with the city since 2023.');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-002', 'Kitchen Garden', '1', 320, 's-001', 'amended loam', 'Annual veg, closest to the gathering shed');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-003', 'Bed A1 (tomatoes/peppers)', '1', 24, 's-002', 'loam + compost', '');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-004', 'Bed A2 (brassicas)', '1', 24, 's-002', 'loam + compost', '');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-005', 'Bed A3 (alliums)', '1', 18, 's-002', 'loam', 'Garlic from autumn 2025 still finishing');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-006', 'Food Forest', '2', 1800, 's-001', 'improved', 'Apple/pear guild + understory of currants and comfrey');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-007', 'Greenhouse', '1', 48, 's-001', 'potting mix in containers', 'Seedlings + early tomato/cucumber starts');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-008', 'Pollinator Strip', '4', 220, 's-001', 'sandy', 'Native wildflowers along the road verge');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-009', 'Pond', '5', 90, 's-001', 'clay', 'Rainwater + grey-water cascade endpoint. Mostly wild.');
INSERT INTO "seed_permaculture_org"."site" ("id", "name", "zone", "area_m2", "parent_site", "soil_type", "notes") VALUES ('s-010', 'Compost yard', '1', 30, 's-001', 'n/a', 'Three-bay system + leaf mold pile');

INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-001', 'Sift bay-1 finished compost', 'maintenance', 2, 'wp-004', 's-010', 'm-002', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-002', 'Rebuild bay-2 wall (pallet replacement)', 'building', 2, 'wp-004', 's-010', 'm-009', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-003', 'Turn bay-3 (hot pile)', 'maintenance', 1, 'wp-004', 's-010', 'm-004', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-004', 'Transplant 24 tomato starts → Bed A1', 'planting', 2, 'wp-002', 's-003', 'm-003', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-005', 'Transplant 18 pepper starts → Bed A1', 'planting', 1.5, 'wp-002', 's-003', 'm-010', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-006', 'Mulch transplants with straw', 'mulching', 1, 'wp-002', 's-003', 'm-007', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-007', 'Light summer prune of 4 apple trees', 'maintenance', 2, 'wp-005', 's-006', 'm-003', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-008', 'Spread ramial mulch under apple guild', 'mulching', 2, 'wp-005', 's-006', 'm-007', 'done');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-009', 'Greet newcomers + lead 11am tour', 'facilitation', 2, 'wp-006', 's-001', 'm-008', 'claimed');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-010', 'Set up tea + snacks for Open Saturday', 'facilitation', 1, 'wp-006', 's-001', 'm-005', 'claimed');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-011', 'Photograph the day for the newsletter', 'outreach', 1, 'wp-006', 's-001', 'm-011', 'claimed');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-012', 'Pull garlic (Bed A3, ~80 heads)', 'harvest', 3, 'wp-007', 's-005', NULL, 'open');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-013', 'Bunch + hang garlic in shed', 'harvest', 1, 'wp-007', 's-005', NULL, 'open');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-014', 'Walk all drip lines, log leaks', 'maintenance', 1.5, 'wp-008', 's-001', NULL, 'open');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-015', 'Measure cistern level + flush sediment', 'maintenance', 1, 'wp-008', 's-001', NULL, 'open');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-016', 'Daily watering rota — week of May 12', 'watering', 0.5, NULL, 's-002', 'm-010', 'in_progress');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-017', 'Weed Bed A2 brassicas (flea beetle check)', 'weeding', 1, NULL, 's-004', 'm-007', 'in_progress');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-018', 'Write May newsletter draft', 'outreach', 2, NULL, NULL, 'm-008', 'in_progress');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-019', 'Order autumn brassica seeds', 'outreach', 0.5, NULL, NULL, NULL, 'open');
INSERT INTO "seed_permaculture_org"."task" ("id", "title", "kind", "estimated_hours", "work_party", "site", "claimed_by", "status") VALUES ('t-020', 'Fix east-fence sag near pond', 'building', 2, NULL, 's-009', NULL, 'open');

INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-001', 'Spring bed prep', '2026-03-14T09:00:00Z', 4, 's-002', 'm-001', 'Turn compost into Beds A1-A3, lay fresh mulch paths', 'completed');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-002', 'Seedling transplant day', '2026-04-25T09:00:00Z', 5, 's-007', 'm-003', 'Move tomato/pepper/basil starts from greenhouse to beds', 'completed');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-003', 'Pollinator strip seeding', '2026-04-02T10:00:00Z', 3, 's-008', 'm-006', 'Reseed wildflower mix; mulch with straw', 'completed');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-004', 'Compost turn + bay rebuild', '2026-05-09T09:30:00Z', 4, 's-010', 'm-002', 'Turn all 3 bays; rebuild collapsed wall on bay 2', 'completed');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-005', 'Apple guild mulch + pruning', '2026-05-16T09:00:00Z', 4, 's-006', 'm-001', 'Summer prune apples; refresh ramial mulch around guilds', 'completed');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-006', 'Open Saturday + tour', '2026-05-23T10:00:00Z', 3, 's-001', 'm-008', 'Open day for newcomers; light weeding + tour', 'scheduled');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-007', 'Garlic harvest', '2026-07-04T08:00:00Z', 5, 's-005', 'm-003', 'Pull, bunch, hang to cure in shed', 'scheduled');
INSERT INTO "seed_permaculture_org"."work_party" ("id", "title", "starts_at", "duration_hours", "site", "coordinator", "description", "status") VALUES ('wp-008', 'Mid-summer water audit', '2026-07-18T08:00:00Z', 3, 's-001', 'm-006', 'Check drip lines + cistern; reroute if needed', 'scheduled');

INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-001', 'wp-001', 4, 'facilitator');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-002', 'wp-001', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-003', 'wp-001', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-004', 'wp-001', 3, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-007', 'wp-001', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-003', 'wp-002', 5, 'facilitator');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-007', 'wp-002', 5, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-010', 'wp-002', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-005', 'wp-002', 3, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-006', 'wp-003', 3, 'facilitator');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-004', 'wp-003', 3, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-001', 'wp-003', 2, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-002', 'wp-004', 4, 'facilitator');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-009', 'wp-004', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-004', 'wp-004', 3, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-001', 'wp-005', 4, 'facilitator');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-003', 'wp-005', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-007', 'wp-005', 4, 'participant');
INSERT INTO "seed_permaculture_org"."member_attended_work_party" ("member_id", "work_party_id", "hours_contributed", "role") VALUES ('m-002', 'wp-005', 2, 'participant');

COMMIT;
