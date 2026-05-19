# Seed bundles

Each subdirectory is a self-contained acropolisOS bundle: ontology YAML + roles + sample data. Boots the kernel into a domain-specific starting state for experimentation.

## Bundles

| Bundle | Domain | Object types | Data rows | Stress-tests |
|---|---|---|---|---|
| `empty/` | Minimal | (none beyond base roles) | 0 | Cold-start path |
| `small-community/` | Generic community | Member, Event, MeetingMinute | small | Base kernel |
| `permaculture-org/` | Regenerative-ag garden coop | Member, Site, Planting, Observation, WorkParty, Task, Harvest | ~80 rows | Spatial hierarchy (Site.subsite_of), seasonal evolution, soft semantic data (Observation), free-form skills |
| `hostel/` | Small hostel + work-trade | Member, Guest, Room, Bed, Booking, Shift, WorkTradeAgreement, Event, IncidentLog | ~70 rows | High-turnover transactional, capacity constraints (bed double-booking, shift claims), graduated role evolution (Guest → WorkTrader → Member) |

## Bundle layout

```
<bundle>/
  README.md            — what this bundle models, why it's interesting
  roles.yaml           — role definitions
  properties.yaml      — shared property refs
  link-types.yaml      — edges between object types
  object-types/        — one YAML per object type
  action-types/        — one YAML per action type
  data/                — one JSON per object/link type, hand-seeded sample rows
```

## Why two domain-specific bundles

Permaculture and hostel have **maximally different shapes**:

- Permaculture is seasonal / biological / spatial / soft-semantic.
- Hostel is real-time / transactional / capacity-constrained / role-graduated.

If the acropolisOS kernel (chat→ontology-diff, typed actions, object graph) handles both with the same code path, the moat is real. If one feels forced, the kernel needs work.

## Loading

Loader script not yet present; expected path: `scripts/seed-from-bundle.ts <bundle-name>`. The data JSON files are flat arrays of records keyed by ontology terms, so any straightforward loader will work — Drizzle insert, raw SQL `COPY FROM`, or a Mastra tool that calls each action type.

## Sources of inspiration (real-world data shapes)

- **Permaculture**: farmOS entity model (assets/logs/quantities/taxonomy_terms), LiteFarm crop plans, OpenTEAM Ag Data Wallet schemas, Hylo regenerative-ag groups
- **Hostel**: HotelDruid + QloApps schemas, Workaway/Worldpackers work-exchange profile shape, Hostelworld/Booking.com OTA channel-manager data model
