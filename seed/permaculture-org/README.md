# Seed: Permaculture Organization

Reference ontology for a small permaculture / regenerative-agriculture community (10–80 active volunteers) coordinating a shared site across the seasons. Modelled after a typical Terran Collective / OpenTEAM-adjacent garden cooperative.

## Object types

- **Member** — a person in the org. Role on top of base roles: `tier_role` is one of `visitor / volunteer / steward / coordinator`. Skills are free-form tags.
- **Site** — a plot, bed, food forest, water feature, or building. Carries `zone` (permaculture zone 0–5) and `parent_site` for nesting (Bed → Plot → Whole Site).
- **Planting** — a specific crop or perennial at a Site at a point in time. Has `species`, `variety`, `planted_at`, `expected_harvest`, `status`.
- **Observation** — a member's note about a Site or Planting. Free text plus optional `category` (pest, disease, growth, weather, soil).
- **WorkParty** — a scheduled gathering with tasks attached. Has `starts_at`, `site`, `coordinator`.
- **Task** — a unit of work that can be claimed by a member. Has `kind` (planting / weeding / harvest / mulching / building / facilitation), `estimated_hours`, `claimed_by`.
- **Harvest** — a yield log. `quantity`, `unit`, `harvested_at`, `from_planting`.

## Link types

- **attended** — Member ↔ WorkParty, many-to-many. Carries `hours_contributed` and `role` (participant / facilitator).
- **assigned_to** — Member → Task, one-to-one (a task is either unclaimed or held by exactly one member).
- **located_at** — Planting → Site, one-to-one.
- **yielded** — Planting → Harvest, one-to-many.
- **observed** — Member → Observation, one-to-many.
- **subsite_of** — Site → Site, many-to-one (Bed nested inside Plot).

## Action types

- **log_observation** — any member captures an observation. `auto_apply`.
- **schedule_work_party** — coordinator schedules a gathering. `always_confirm`.
- **claim_task** — member self-assigns to an open task. `auto_apply`.
- **record_harvest** — member or steward logs yield. `auto_apply`.
- **add_planting** — steward records a new planting. `always_confirm`.

## Roles

- **member** — base role, any verified account.
- **steward** — trusted operator with write access across the org.
- **coordinator** — can schedule work parties and reorganise sites.

## Why this ontology

The schema deliberately exposes three different shapes the propose pipeline must handle:

1. **Strongly typed transactional** — Harvest, Task (clean CRUD)
2. **Spatial / hierarchical** — Site with `subsite_of` self-reference (graph traversal kicks in here, AGE earns its keep)
3. **Soft / semantic** — Observation (free text where chat → ontology evolution gets interesting: "we keep logging slugs, should there be a Pest object type?")

## Data

`data/` contains hand-seeded JSON records — roughly one growing-season's worth (March–October) of activity at a mid-size garden cooperative. Total ~80 rows across object types. Load with `scripts/seed-from-json.ts <bundle-path>` (TODO if not present).
