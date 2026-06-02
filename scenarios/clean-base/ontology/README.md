# Seed: Small Community

Reference ontology for a 50–200 person community installation. Boots acropolisOS into an immediately useful state.

## Object types

- **Member** — a person in the community. Has `tier` (basic / sustaining / lifetime). `notes` field is steward-only.
- **Event** — a scheduled gathering, open to members by default.
- **MeetingMinute** — notes captured from an Event.

## Link types

- **attended** — Member ↔ Event, many-to-many. Carries `attended_at` and `role` (attendee / organizer / speaker).
- **authored** — Member → MeetingMinute, one-to-many.

## Action types

- **add_member** — steward creates a Member. `always_confirm` policy.
- **record_attendance** — steward or member-themselves logs attendance. `auto_apply` policy.
- **change_tier** — steward promotes/demotes a member. Function-backed (`functions/change-tier.ts`).
- **add_meeting_minute** — any member captures notes after an event.

## Roles

- **member** — anyone with a verified account.
- **steward** — trusted operator who can act on others' behalf.

`member_self` is a permission token (not a role) meaning "the row whose id matches the current actor".
